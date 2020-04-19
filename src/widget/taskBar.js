const { Clutter, GObject, St, Shell, Gio, GLib } = imports.gi;

const Tweener = imports.ui.tweener;
const DND = imports.ui.dnd;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { MatButton } = Me.imports.src.widget.material.button;
const { ShellVersionMatch } = Me.imports.src.utils.compatibility;
const { MsWindow } = Me.imports.src.layout.msWorkspace.msWindow;
const { AddLogToFunctions } = Me.imports.src.utils.debug;
const { reparentActor } = Me.imports.src.utils.index;

let dragData = null;

/* exported TaskBar */
var TaskBar = GObject.registerClass(
    class TaskBar extends St.Widget {
        _init(msWorkspace) {
            AddLogToFunctions(this);
            super._init({
                name: 'taskBar',
                x_expand: true,
            });
            this._delegate = this;
            this.taskActiveIndicator = new St.Widget({
                style_class: 'task-active-indicator',
            });
            this.add_child(this.taskActiveIndicator);
            this.taskButtonContainer = new St.Widget({
                layout_manager: new Clutter.BoxLayout(),
            });
            this.add_child(this.taskButtonContainer);
            this.msWorkspace = msWorkspace;
            this.connect('destroy', this._onDestroy.bind(this));
            this.msWorkspaceSignals = [
                msWorkspace.connect('tileableList-changed', () => {
                    this.onTileableListChange();
                }),
                msWorkspace.connect(
                    'tileable-focus-changed',
                    (_, tileable, oldTileable) => {
                        this.onFocusChanged(tileable, oldTileable);
                    }
                ),
            ];

            this.tracker = Shell.WindowTracker.get_default();
            this.windowFocused = null;
            this.items = [];
            this.updateItems();
            this._animateActiveIndicator();
        }

        onTileableListChange() {
            this.updateItems();
            this._animateActiveIndicator();
        }

        onFocusChanged(tileableFocused, oldTileableFocused) {
            if (tileableFocused === oldTileableFocused) {
                return;
            }

            let previousItem = this.getTaskBarItemOfTileable(
                oldTileableFocused
            );
            let nextItem = this.getTaskBarItemOfTileable(tileableFocused);

            if (previousItem) {
                if (
                    previousItem.actorContainer.has_style_class_name('active')
                ) {
                    previousItem.actorContainer.remove_style_class_name(
                        'active'
                    );
                }
            }

            if (!nextItem) return;

            //if you change the class before animate the indicator there is an issue for retrieving the item.x
            this._animateActiveIndicator();
            nextItem.actorContainer.add_style_class_name('active');
        }

        updateItems() {
            this.items.forEach((item) => item.destroy());
            this.items = this.msWorkspace.tileableList.map(
                (tileable, index) => {
                    if (tileable instanceof MsWindow) {
                        const item = new TileableItem(tileable);

                        item.connect('left-clicked', (_) => {
                            this.msWorkspace.focusTileable(tileable);
                        });
                        item.connect('right-clicked', (_) => {
                            tileable.kill();
                        });
                        item.connect('close-clicked', (_) => {
                            tileable.kill();
                        });

                        item._draggable.connect('drag-begin', () => {
                            const initialIndex = this.msWorkspace.tileableList.indexOf(
                                item.tileable
                            );
                            const dropPlaceholder = new DropPlaceholder(
                                TaskBarItem
                            );
                            dragData = {
                                item,
                                initialIndex,
                                dropPlaceholder,
                                originalTaskBar: this,
                                currentTaskBar: this,
                            };
                            dropPlaceholder.connect(
                                'drag-dropped',
                                this.reparentDragItem
                            );
                            dropPlaceholder.connect('drag-over', () => {
                                dragData.draggedOverByChild = true;
                            });

                            dropPlaceholder.resize(item);
                            this.taskButtonContainer.add_child(dropPlaceholder);
                            this.taskButtonContainer.set_child_at_index(
                                dropPlaceholder,
                                initialIndex
                            );
                            this.taskActiveIndicator.hide();
                        });

                        item._draggable.connect('drag-cancelled', () => {
                            delete dragData.draggedOver;
                            delete dragData.draggedBefore;
                            // We need to reparent on the original taskBar
                            // if it's a different one
                            dragData.originalTaskBar.updateCurrentTaskBar();

                            const {
                                currentTaskBar,
                                dropPlaceholder,
                                initialIndex,
                            } = dragData;

                            currentTaskBar.taskButtonContainer.set_child_at_index(
                                dropPlaceholder,
                                initialIndex
                            );
                        });

                        item._draggable.connect(
                            'drag-end',
                            this._onDragEnd.bind(this)
                        );

                        item.connect('drag-over', (_, before) => {
                            dragData.draggedOverByChild = true;
                            this._onDragOver(item, before);
                        });

                        item.connect('drag-dropped', this.reparentDragItem);
                        this.taskButtonContainer.add_child(item);
                        return item;
                    } else {
                        const item = new IconTaskBarItem(
                            tileable,
                            Gio.icon_new_for_string(
                                `${Me.path}/assets/icons/plus-symbolic.svg`
                            )
                        );
                        item.connect('left-clicked', (_) => {
                            this.msWorkspace.focusTileable(tileable);
                        });
                        this.taskButtonContainer.add_child(item);
                        return item;
                    }
                }
            );

            this.items[
                this.msWorkspace.focusedIndex
            ].actorContainer.add_style_class_name('active');
        }

        updateCurrentTaskBar() {
            const { dropPlaceholder } = dragData;

            if (dragData.currentTaskBar !== this) {
                reparentActor(dropPlaceholder, this.taskButtonContainer);
                dragData.currentTaskBar = this;
            }

            return DND.DragMotionResult.MOVE_DROP;
        }

        reparentDragItem() {
            const { item, currentTaskBar } = dragData;
            reparentActor(item, currentTaskBar.taskButtonContainer);
        }

        _onDragEnd() {
            const {
                item,
                originalTaskBar,
                currentTaskBar,
                dropPlaceholder,
                draggedOver,
                draggedBefore,
            } = dragData;
            let index = currentTaskBar.taskButtonContainer
                .get_children()
                .indexOf(dropPlaceholder);
            currentTaskBar.taskButtonContainer.remove_child(dropPlaceholder);
            dropPlaceholder.destroy();
            currentTaskBar.taskButtonContainer.set_child_at_index(item, index);
            if (
                originalTaskBar !== currentTaskBar &&
                item.tileable.metaWindow
            ) {
                item.tileable.metaWindow.move_to_monitor(
                    currentTaskBar.msWorkspace.monitor.index
                );
            }
            if (draggedOver) {
                if (draggedBefore) {
                    currentTaskBar.msWorkspace.setTileableBefore(
                        item.tileable,
                        draggedOver.tileable
                    );
                } else {
                    currentTaskBar.msWorkspace.setTileableAfter(
                        item.tileable,
                        draggedOver.tileable
                    );
                }
            }

            currentTaskBar.msWorkspace.focusTileable(item.tileable);
            this.taskActiveIndicator.show();
            dragData = null;
        }

        _onDragOver(item, before) {
            dragData.draggedOver = item;
            dragData.draggedBefore = before;
            this.updateCurrentTaskBar();

            const {
                currentTaskBar,
                dropPlaceholder,
                draggedOver,
                draggedBefore,
            } = dragData;

            const dropPlaceholderIndex = currentTaskBar.taskButtonContainer
                .get_children()
                .indexOf(dropPlaceholder);
            const itemIndex = currentTaskBar.taskButtonContainer
                .get_children()
                .indexOf(draggedOver);
            const toIndex =
                dropPlaceholderIndex < itemIndex ? itemIndex - 1 : itemIndex;
            currentTaskBar.taskButtonContainer.set_child_at_index(
                dropPlaceholder,
                toIndex + (draggedBefore ? 0 : 1)
            );
        }

        _animateActiveIndicator() {
            let taskBarItem = this.getTaskBarItemOfTileable(
                this.msWorkspace.tileableFocused
            );
            if (!taskBarItem.widthSignalId) {
                taskBarItem.widthSignalId = taskBarItem.connect(
                    'notify::width',
                    () => {
                        if (!dragData) this._animateActiveIndicator();
                    }
                );
            }
            if (!this.mapped) return;
            if (ShellVersionMatch('3.32')) {
                Tweener.addTween(this.taskActiveIndicator, {
                    translation_x: taskBarItem.x,
                    width: taskBarItem.width,
                    time: 0.25,
                    transition: 'easeOutQuad',
                });
            } else {
                this.taskActiveIndicator.ease({
                    translation_x: taskBarItem.x,
                    width: taskBarItem.width,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }

        getTaskBarItemOfTileable(tileable) {
            return this.items.find((item) => {
                return item.tileable === tileable;
            });
        }
        vfunc_allocate(box, flags) {
            this.set_allocation(box, flags);
            let themeNode = this.get_theme_node();
            const contentBox = themeNode.get_content_box(box);
            this.taskButtonContainer.allocate(box, flags);

            let taskActiveIndicatorBox = new Clutter.ActorBox();
            taskActiveIndicatorBox.x1 = contentBox.x1;
            taskActiveIndicatorBox.x2 =
                contentBox.x1 +
                this.taskActiveIndicator.get_preferred_width(-1)[0];
            taskActiveIndicatorBox.y1 =
                contentBox.y2 -
                this.taskActiveIndicator.get_preferred_height(-1)[0];
            taskActiveIndicatorBox.y2 = contentBox.y2;
            this.taskActiveIndicator.allocate(taskActiveIndicatorBox, flags);
        }

        _onDestroy() {
            log('Taskbar to its own destroy');
            this.msWorkspaceSignals.forEach((signal) =>
                this.msWorkspace.disconnect(signal)
            );
        }
    }
);

let TaskBarItem = GObject.registerClass(
    {
        Signals: {
            'drag-dropped': {},
            'drag-over': {
                param_types: [GObject.TYPE_BOOLEAN],
            },
            'left-clicked': {},
            'right-clicked': {},
            'close-clicked': {},
        },
    },
    class TaskBarItemClass extends MatButton {
        _init(contentActor, draggable) {
            super._init({
                style_class: 'task-bar-item ',
            });
            this.y_expand = true;
            this._delegate = this;
            this.draggable = draggable;
            this.contentActor = contentActor;
            this.set_child(this.contentActor);
            this.mouseData = {
                pressed: false,
                dragged: false,
                originalCoords: null,
                originalSequence: null,
            };

            this.connect('event', (actor, event) => {
                let eventType = event.type();
                switch (eventType) {
                    case Clutter.EventType.BUTTON_PRESS:
                    case Clutter.EventType.TOUCH_BEGIN:
                        this.mouseData.pressed = true;
                        this.mouseData.originalCoords = event.get_coords();
                        this.mouseData.originalSequence = event.get_event_sequence();
                        break;

                    case Clutter.EventType.MOTION:
                    case Clutter.EventType.TOUCH_UPDATE:
                        if (this.mouseData.pressed && !this.mouseData.dragged) {
                            let coords = event.get_coords();
                            if (
                                Math.abs(
                                    this.mouseData.originalCoords[0] - coords[0]
                                ) > this.get_preferred_height(-1)[1] &&
                                !this.mouseData.dragged
                            ) {
                                if (this.draggable) {
                                    this.mouseData.dragged = true;
                                    this._draggable.startDrag(
                                        this.mouseData.originalCoords[0],
                                        this.mouseData.originalCoords[1],
                                        global.get_current_time(),
                                        this.mouseData.originalSequence
                                    );
                                }
                            }
                        }
                        break;

                    case Clutter.EventType.BUTTON_RELEASE:
                    case Clutter.EventType.TOUCH_END:
                        this.mouseData.pressed = false;
                        this.mouseData.dragged = false;
                        switch (event.get_button()) {
                            case 1:
                                this.emit('left-clicked');
                                break;

                            case 2:
                                this.emit('right-clicked');
                                break;
                        }
                        break;

                    case Clutter.EventType.LEAVE:
                        if (this.mouseData.pressed && !this.mouseData.dragged) {
                            if (this.draggable) {
                                this.mouseData.dragged = true;
                                this._draggable.startDrag(
                                    this.mouseData.originalCoords[0],
                                    this.mouseData.originalCoords[1],
                                    global.get_current_time(),
                                    this.mouseData.originalSequence
                                );
                            }
                        }
                        break;
                }
            });

            if (this.draggable) {
                this.initDrag();
            }
        }

        initDrag() {
            this._draggable = DND.makeDraggable(this, {
                restoreOnSuccess: false,
                manualMode: true,
            });

            this._draggable.connect('drag-end', () => {
                this.mouseData.pressed = false;
                this.mouseData.dragged = false;
            });
        }

        handleDragOver(source, actor, x) {
            if (!this.draggable || !(source instanceof TaskBarItem)) {
                return DND.DragMotionResult.NO_DROP;
            }
            this.emit('drag-over', x < this.width / 2);
            return DND.DragMotionResult.MOVE_DROP;
        }

        acceptDrop(source) {
            if (!this.draggable || !(source instanceof TaskBarItem)) {
                return false;
            }
            this.emit('drag-dropped');
            return true;
        }
    }
);

let TileableItem = GObject.registerClass(
    {
        Signals: {
            'close-clicked': {},
        },
    },
    class TileableItemClass extends TaskBarItem {
        _init(tileable) {
            this.container = new St.BoxLayout({
                style_class: 'task-bar-item-content',
            });
            super._init(this.container, true);
            this.tileable = tileable;
            this.app = tileable.app;
            this.iconContainer = new St.Bin();

            // TITLE
            this.title = new St.Label({
                style_class: 'task-bar-item-title',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.updateTitle();

            this.connectSignal = this.tileable.connect('title-changed', () => {
                this.updateTitle();
            });

            // CLOSE BUTTON
            this.closeButton = new St.Button({
                style_class: 'task-close-button',
                child: new St.Icon({
                    style_class: 'task-close-icon',
                    gicon: Gio.icon_new_for_string(
                        `${Me.path}/assets/icons/close-symbolic.svg`
                    ),
                }),
            });

            this.closeButton.connect('clicked', () => {
                this.emit('close-clicked');
            });

            // LAYOUT CONTAINER
            this.container.add_child(this.iconContainer);
            this.container.add_child(this.title);
            this.container.add_child(this.closeButton);
        }

        buildIcon(height) {
            if (this.icon) this.icon.destroy();
            this.iconSize = height;
            this.icon = this.app.create_icon_texture(this.iconSize / 2);
            this.icon.style_class = 'app-icon';
            this.iconContainer.set_child(this.icon);
            this.queue_relayout();
        }

        // Update the title and crop it if it's too long
        updateTitle() {
            this.title.text = this.tileable.title;
        }
        vfunc_allocate(box, flags) {
            if (!this.icon || this.iconSize != box.get_height()) {
                this.buildIcon(box.get_height());
            }
            super.vfunc_allocate(box, flags);
        }
        _onDestroy() {
            log('TaskbarItem to its own destroy');
            if (this.connectSignal) {
                this.tileable.disconnect(this.connectSignal);
            }
        }
    }
); /* 
let TileableContent = GObject.registerClass(
    {
        Signals: {
            'close-clicked': {},
        },
    },
    class TileableContentClass extends St.Widget {
        _init(tileable) {
            super._init({
                style_class: 'task-bar-item-content',
            });
            this.connect('destroy', this._onDestroy.bind(this));
            tileable.connect('destroy', () => {
                delete this.connectSignal;
            });
            this.tileable = tileable;
            this.app = tileable.app;
            if (this.app) {
                // ICON
            }

            // TITLE
            this.title = new St.Label({
                style_class: 'task-bar-item-title',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.updateTitle();

            this.connectSignal = this.tileable.connect('title-changed', () => {
                this.updateTitle();
            });

            // CLOSE BUTTON
            this.closeButton = new St.Button({
                style_class: 'task-close-button',
                child: new St.Icon({
                    style_class: 'task-close-icon',
                    gicon: Gio.icon_new_for_string(
                        `${Me.path}/assets/icons/close-symbolic.svg`
                    ),
                }),
            });

            this.closeButton.connect('clicked', () => {
                this.emit('close-clicked');
            });

            // LAYOUT CONTAINER
            this.add_child(this.title);
            this.add_child(this.closeButton);
        }

        buildIcon(height) {
            if (this.icon) this.icon.destroy();
            this.iconSize = height;
            log('iconSize', this.iconSize);
            this.icon = this.app.create_icon_texture(this.iconSize / 2);
            this.icon.style_class = 'app-icon';
            this.add_child(this.icon);
        }

        // Update the title and crop it if it's too long
        updateTitle() {
            this.title.text = this.tileable.title;
        }

        vfunc_get_preferred_width(_forHeight) {
            let maxIconWidth = this.icon ? this.iconSize : 0;
            log('maxTitleWidth', this.title.get_preferred_width(_forHeight));
            let maxTitleWidth = this.title.get_preferred_width(_forHeight)[1];
            let maxCloseWidth = this.closeButton.get_preferred_width(-1)[1];
            return [
                maxIconWidth + maxCloseWidth,
                maxIconWidth + maxTitleWidth + maxCloseWidth,
            ];
        }
        vfunc_get_preferred_height(_forWidth) {
            return [
                super.vfunc_get_preferred_height(_forWidth)[1],
                super.vfunc_get_preferred_height(_forWidth)[1],
            ];
        }
        vfunc_allocate(box, flags) {
            log('width', box.get_width(), this.get_preferred_width(-1));
            log('height', box.get_height(), this.get_preferred_height(-1));

            this.set_allocation(box, flags);
            let themeNode = this.get_theme_node();
            box = themeNode.get_content_box(box);
            let iconBox = new Clutter.ActorBox();
            iconBox.x1 = box.x1;
            iconBox.x2 = box.get_height();
            iconBox.y1 = box.y1;
            iconBox.y2 = box.y2;
            if (!this.icon || iconBox.get_height() != this.iconSize) {
                this.buildIcon(iconBox.get_height());
            }
            if (this.icon) {
                this.icon.allocate(iconBox, flags);
            }
            let closeButtonBox = new Clutter.ActorBox();
            closeButtonBox.x1 =
                box.x2 - this.closeButton.get_preferred_width(-1)[1];
            closeButtonBox.x2 = box.x2;
            closeButtonBox.y1 =
                (box.get_height() -
                    this.closeButton.get_preferred_height(-1)[1]) /
                2;
            closeButtonBox.y2 =
                closeButtonBox.y1 +
                this.closeButton.get_preferred_height(-1)[1];
            log(
                'closeButtonBox',
                closeButtonBox.x1,
                closeButtonBox.x2,
                closeButtonBox.y1,
                closeButtonBox.y2
            );
            this.closeButton.allocate(closeButtonBox, flags);

            let titleBox = new Clutter.ActorBox();
            titleBox.x1 = iconBox.x2;
            titleBox.x2 = closeButtonBox.x1;
            titleBox.y1 = box.y1;
            titleBox.y2 = box.y2;
            log('titleBox', titleBox.x1, titleBox.x2, titleBox.y1, titleBox.y2);
            this.title.allocate(titleBox, flags);
        }

        _onDestroy() {
            log('TaskbarItem to its own destroy');
            if (this.connectSignal) {
                this.tileable.disconnect(this.connectSignal);
            }
        }
    }
); */

let IconTaskBarItem = GObject.registerClass(
    class IconTaskBarItem extends TaskBarItem {
        _init(tileable, gicon) {
            this.container = new St.Bin({
                style_class: 'task-bar-icon-container',
            });
            super._init(this.container, false);
            this.tileable = tileable;

            this.icon = new St.Icon({
                gicon,
                style_class: 'icon',
            });
            this.container.set_child(this.icon);
        }
    }
);

var DropPlaceholder = GObject.registerClass(
    {
        Signals: {
            'drag-dropped': {},
            'drag-over': {},
        },
    },
    class DropPlaceholder extends St.Widget {
        _init(targetClass) {
            super._init();
            this.targetClass = targetClass;
            this.set_style('background:rgba(255,255,255,0.1)');
            this._delegate = this;
        }

        handleDragOver(source) {
            if (!(source instanceof this.targetClass)) {
                return DND.DragMotionResult.NO_DROP;
            }
            this.emit('drag-over');
            return DND.DragMotionResult.MOVE_DROP;
        }

        acceptDrop(source) {
            if (!(source instanceof this.targetClass)) {
                return false;
            }
            this.emit('drag-dropped');
            return true;
        }

        resize(rect) {
            this.width = rect.width;
            this.height = rect.height;
        }
    }
);
