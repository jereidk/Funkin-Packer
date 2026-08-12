/**
 * AnimationPreviewTool - Standalone experimental panel that plays back AND
 * edits an Animation.json's Adobe Animate-style symbol hierarchy, instead
 * of just listing/counting it like AnimationTreeView does. Independent
 * from Sheet Splitter on purpose - this is a from-scratch playback +
 * editing tool (AnimationRenderer.js / AnimationMatrix.js), not a repack
 * tool.
 *
 * Takes the same three files as a BetterTA export: the atlas texture PNG,
 * its spritemap JSON (the { ATLAS: { SPRITES: [...] } } shape Adobe
 * Animate/BetterTA produces - not this app's own internal rect format),
 * and Animation.json itself.
 *
 * Editing model: click a sprite in the canvas (while "Editar" is on and
 * playback is stopped) to select the exact ASI element instance that drew
 * it at the current frame. Dragging its body moves it, the handle above it
 * rotates it, and the corner handles scale it - all by mutating that
 * element's own MX in place, so the edit only applies to the current
 * keyframe (this format has no interpolation flags to preserve, so that's
 * the correct granularity). A selected ASI can also be reassigned to a
 * different atlas sprite, and its owning layer's frame list can be
 * extended, trimmed, or reordered. "Descargar Animation.json" serializes
 * the (mutated in place) animData back out.
 *
 * Known limitation: rotate/scale gestures compute their delta in SCREEN
 * space and apply it directly to the element's own local MX. That's exact
 * when the element's ancestors aren't themselves rotated/skewed (the
 * common case) and an approximation otherwise - a fully correct version
 * would convert the screen-space delta through the inverse of the
 * accumulated parent transform first.
 */

import React from 'react';
import { Observer, GLOBAL_EVENT } from '../Observer';
import I18 from '../utils/I18';
import AnimationRenderer from '../utils/AnimationRenderer';
import AM from '../utils/AnimationMatrix';

const HANDLE_SIZE = 8;
const ROTATE_HANDLE_OFFSET = 24;

class AnimationPreviewTool extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            textureLoaded: false,
            spritemapLoaded: false,
            animationLoaded: false,
            error: null,
            playing: false,
            tick: 0,
            selectedState: 'all',
            fps: 24,
            zoom: 1,
            editMode: false,
            selectedElement: null, // the raw ASI/SI JSON node, for identity comparison
            selectedKind: null,
            selectedLayer: null,
            selectedFrame: null,
            revision: 0 // bumped on every mutation, since editing changes plain objects setState wouldn't otherwise notice
        };

        this.image = null;
        this.spriteRects = new Map();
        this.animData = null;
        this.rootDuration = 1;
        this.namedStates = [];
        this.rafId = null;
        this.lastFrameTime = 0;
        this.lastDrawList = [];
        this.drag = null; // { mode: 'move'|'rotate'|'scale', entry, startMouse, startMX, startDecomposed }

        this.canvasRef = React.createRef();

        this.close = this.close.bind(this);
        this.selectTexture = this.selectTexture.bind(this);
        this.selectSpritemap = this.selectSpritemap.bind(this);
        this.selectAnimation = this.selectAnimation.bind(this);
        this.togglePlay = this.togglePlay.bind(this);
        this.onStateChange = this.onStateChange.bind(this);
        this.onScrub = this.onScrub.bind(this);
        this.tickLoop = this.tickLoop.bind(this);
        this.toggleEditMode = this.toggleEditMode.bind(this);
        this.onCanvasMouseDown = this.onCanvasMouseDown.bind(this);
        this.onWindowMouseMove = this.onWindowMouseMove.bind(this);
        this.onWindowMouseUp = this.onWindowMouseUp.bind(this);
        this.onReassignSprite = this.onReassignSprite.bind(this);
        this.addFrame = this.addFrame.bind(this);
        this.deleteFrame = this.deleteFrame.bind(this);
        this.moveFrame = this.moveFrame.bind(this);
        this.downloadAnimationJson = this.downloadAnimationJson.bind(this);
    }

    componentDidMount() {
        window.addEventListener('mousemove', this.onWindowMouseMove);
        window.addEventListener('mouseup', this.onWindowMouseUp);
    }

    componentWillUnmount() {
        this.stopLoop();
        window.removeEventListener('mousemove', this.onWindowMouseMove);
        window.removeEventListener('mouseup', this.onWindowMouseUp);
    }

    close() {
        Observer.emit(GLOBAL_EVENT.HIDE_ANIMATION_PREVIEW);
    }

    setError(msg) {
        this.setState({ error: msg });
    }

    bumpRevision() {
        this.setState(prev => ({ revision: prev.revision + 1 }));
        this.renderFrame();
    }

    // --- File loading -------------------------------------------------

    selectTexture(e) {
        let file = e.target.files[0];
        if (!file) return;

        let img = new Image();
        img.onload = () => {
            this.image = img;
            this.setState({ textureLoaded: true, error: null });
            this.renderFrame();
        };
        img.onerror = () => this.setError('No se pudo cargar la textura.');
        img.src = URL.createObjectURL(file);
    }

    selectSpritemap(e) {
        let file = e.target.files[0];
        if (!file) return;

        let reader = new FileReader();
        reader.onload = ev => {
            try {
                let data = JSON.parse(ev.target.result);
                let sprites = data?.ATLAS?.SPRITES;
                if (!Array.isArray(sprites)) {
                    throw new Error('No tiene la forma esperada { ATLAS: { SPRITES: [...] } }');
                }

                this.spriteRects = new Map();
                for (let entry of sprites) {
                    let s = entry.SPRITE;
                    if (s && s.name) this.spriteRects.set(s.name, s);
                }

                this.setState({ spritemapLoaded: true, error: null });
                this.renderFrame();
            } catch (err) {
                this.setError('spritemap.json inválido: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    selectAnimation(e) {
        let file = e.target.files[0];
        if (!file) return;

        let reader = new FileReader();
        reader.onload = ev => {
            try {
                let data = JSON.parse(ev.target.result);
                if (!data.AN || !data.SD) {
                    throw new Error('No tiene la forma esperada { AN, SD, MD }');
                }

                this.animData = data;
                this.rootDuration = AnimationRenderer.getRootDuration(data);
                this.namedStates = AnimationRenderer.listNamedStates(data);

                let fps = data.MD?.FRT || 24;

                this.setState({
                    animationLoaded: true,
                    error: null,
                    fps,
                    tick: 0,
                    selectedState: 'all',
                    selectedElement: null
                });
                this.renderFrame();
            } catch (err) {
                this.setError('Animation.json inválido: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // --- Playback -------------------------------------------------------

    getActiveRange() {
        if (this.state.selectedState === 'all') {
            return { start: 0, duration: this.rootDuration };
        }
        let found = this.namedStates.find(s => s.name === this.state.selectedState);
        return found ? { start: found.startTick, duration: found.duration } : { start: 0, duration: this.rootDuration };
    }

    togglePlay() {
        if (this.state.playing) {
            this.stopLoop();
            this.setState({ playing: false });
        } else {
            this.setState({ playing: true, selectedElement: null }, () => {
                this.lastFrameTime = performance.now();
                this.rafId = requestAnimationFrame(this.tickLoop);
            });
        }
    }

    stopLoop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    tickLoop(now) {
        if (!this.state.playing) return;

        let elapsedSeconds = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        let { start, duration } = this.getActiveRange();
        let ticksElapsed = elapsedSeconds * this.state.fps;
        let localTick = ((this.state.tick - start) + ticksElapsed) % duration;
        if (localTick < 0) localTick += duration;

        this.setState({ tick: start + localTick }, () => this.renderFrame());
        this.rafId = requestAnimationFrame(this.tickLoop);
    }

    onStateChange(e) {
        let selectedState = e.target.value;
        this.setState({ selectedState, selectedElement: null }, () => {
            let { start } = this.getActiveRange();
            this.setState({ tick: start }, () => this.renderFrame());
        });
    }

    onScrub(e) {
        let { start } = this.getActiveRange();
        let localTick = Number(e.target.value);
        this.setState({ tick: start + localTick }, () => this.renderFrame());
    }

    // --- Editing: selection & gizmo --------------------------------------

    toggleEditMode() {
        this.setState(prev => ({ editMode: !prev.editMode, selectedElement: null }), () => this.renderFrame());
    }

    getStageMatrix() {
        let canvas = this.canvasRef.current;
        return [1, 0, 0, 1, (canvas?.width || 0) / 2, (canvas?.height || 0) / 2];
    }

    /** Convert a mouse event to canvas-internal pixel coordinates, undoing the CSS zoom transform. */
    eventToCanvasPoint(e) {
        let canvas = this.canvasRef.current;
        let rect = canvas.getBoundingClientRect();
        return [
            (e.clientX - rect.left) / this.state.zoom,
            (e.clientY - rect.top) / this.state.zoom
        ];
    }

    hitTest(canvasX, canvasY) {
        let stageMatrix = this.getStageMatrix();
        // Topmost (last drawn) first, since later entries paint over earlier ones.
        for (let i = this.lastDrawList.length - 1; i >= 0; i--) {
            let entry = this.lastDrawList[i];
            let rect = this.spriteRects.get(entry.spriteName);
            if (!rect) continue;

            let full = AM.multiply(stageMatrix, entry.matrix);
            let inv = AM.invert(full);
            if (!inv) continue;

            let [lx, ly] = AM.apply(inv, canvasX, canvasY);
            let w = rect.rotated ? rect.h : rect.w;
            let h = rect.rotated ? rect.w : rect.h;
            if (lx >= 0 && lx <= w && ly >= 0 && ly <= h) {
                return entry;
            }
        }
        return null;
    }

    getSelectedEntry() {
        if (!this.state.selectedElement) return null;
        return this.lastDrawList.find(e => e.element === this.state.selectedElement) || null;
    }

    onCanvasMouseDown(e) {
        if (!this.state.editMode || this.state.playing) return;

        let [cx, cy] = this.eventToCanvasPoint(e);
        let stageMatrix = this.getStageMatrix();

        let selected = this.getSelectedEntry();
        if (selected) {
            let rect = this.spriteRects.get(selected.spriteName);
            let full = AM.multiply(stageMatrix, selected.matrix);
            let w = rect?.rotated ? rect.h : (rect?.w || 0);
            let h = rect?.rotated ? rect.w : (rect?.h || 0);

            let [centerX, centerY] = AM.apply(full, w / 2, h / 2);
            let [rotHandleX, rotHandleY] = AM.apply(full, w / 2, -ROTATE_HANDLE_OFFSET / this.state.zoom);
            let [cornerX, cornerY] = AM.apply(full, w, h);

            if (Math.hypot(cx - rotHandleX, cy - rotHandleY) < HANDLE_SIZE) {
                this.beginDrag('rotate', selected, cx, cy, centerX, centerY);
                return;
            }
            if (Math.hypot(cx - cornerX, cy - cornerY) < HANDLE_SIZE) {
                this.beginDrag('scale', selected, cx, cy, centerX, centerY);
                return;
            }
        }

        let hit = this.hitTest(cx, cy);
        if (hit) {
            this.setState({
                selectedElement: hit.element,
                selectedKind: hit.kind,
                selectedLayer: hit.layer,
                selectedFrame: hit.frame
            }, () => this.renderFrame());
            this.beginDrag('move', hit, cx, cy, null, null);
        } else {
            this.setState({ selectedElement: null }, () => this.renderFrame());
        }
    }

    beginDrag(mode, entry, mouseX, mouseY, centerX, centerY) {
        let node = entry.element.ASI || entry.element.SI;
        this.drag = {
            mode,
            entry,
            node,
            startMouse: [mouseX, mouseY],
            startCenter: [centerX, centerY],
            startMX: (node.MX || AM.IDENTITY).slice(),
            startDecomposed: AM.decompose(node.MX || AM.IDENTITY),
            // Vector-only inverse of the entry's parent transform (stage * ancestors),
            // used to turn a screen-space mouse delta into this element's own local
            // MX space for the move gesture. See the module doc comment for why
            // rotate/scale don't also go through this (screen-space approximation).
            parentInverse: AM.invert(AM.multiply(this.getStageMatrix(), entry.parentMatrix))
        };
    }

    onWindowMouseMove(e) {
        if (!this.drag) return;
        let [cx, cy] = this.eventToCanvasPoint(e);
        let { mode, node, startMouse, startMX, startDecomposed, startCenter, parentInverse } = this.drag;

        if (mode === 'move') {
            if (!parentInverse) return;
            let dx = cx - startMouse[0];
            let dy = cy - startMouse[1];
            // Vector transform (no translation component) through the inverse
            // parent matrix, so a screen-space drag maps to this element's own
            // local MX units regardless of ancestor scale/rotation.
            let localDx = parentInverse[0] * dx + parentInverse[2] * dy;
            let localDy = parentInverse[1] * dx + parentInverse[3] * dy;
            node.MX = [startMX[0], startMX[1], startMX[2], startMX[3], startMX[4] + localDx, startMX[5] + localDy];
        } else if (mode === 'rotate') {
            let startAngle = Math.atan2(startMouse[1] - startCenter[1], startMouse[0] - startCenter[0]);
            let currentAngle = Math.atan2(cy - startCenter[1], cx - startCenter[0]);
            let delta = currentAngle - startAngle;
            node.MX = AM.compose({ ...startDecomposed, rotation: startDecomposed.rotation + delta });
        } else if (mode === 'scale') {
            let startDist = Math.hypot(startMouse[0] - startCenter[0], startMouse[1] - startCenter[1]) || 1;
            let currentDist = Math.hypot(cx - startCenter[0], cy - startCenter[1]);
            let ratio = currentDist / startDist;
            node.MX = AM.compose({
                ...startDecomposed,
                scaleX: startDecomposed.scaleX * ratio,
                scaleY: startDecomposed.scaleY * ratio
            });
        }

        this.renderFrame();
    }

    onWindowMouseUp() {
        if (this.drag) {
            this.drag = null;
            this.bumpRevision();
        }
    }

    onReassignSprite(e) {
        let entry = this.getSelectedEntry();
        if (!entry || entry.kind !== 'ASI') return;
        entry.element.ASI.N = e.target.value;
        this.bumpRevision();
    }

    // --- Editing: timeline frames -----------------------------------------

    getSelectedLayerFrames() {
        return this.state.selectedLayer?.FR || null;
    }

    recomputeFrameOffsets(frames) {
        let running = 0;
        for (let f of frames) {
            f.I = running;
            running += f.DU || 1;
        }
    }

    addFrame() {
        let frames = this.getSelectedLayerFrames();
        let current = this.state.selectedFrame;
        if (!frames || !current) return;

        let idx = frames.indexOf(current);
        if (idx < 0) return;

        let clone = JSON.parse(JSON.stringify(current));
        clone.DU = 1;
        delete clone.N; // a duplicated frame isn't a new named state
        frames.splice(idx + 1, 0, clone);
        this.recomputeFrameOffsets(frames);
        this.rootDuration = AnimationRenderer.getRootDuration(this.animData);
        this.namedStates = AnimationRenderer.listNamedStates(this.animData);
        this.bumpRevision();
    }

    deleteFrame() {
        let frames = this.getSelectedLayerFrames();
        let current = this.state.selectedFrame;
        if (!frames || !current || frames.length <= 1) return;

        let idx = frames.indexOf(current);
        if (idx < 0) return;

        frames.splice(idx, 1);
        this.recomputeFrameOffsets(frames);
        this.rootDuration = AnimationRenderer.getRootDuration(this.animData);
        this.namedStates = AnimationRenderer.listNamedStates(this.animData);
        this.setState({ selectedElement: null, selectedFrame: null }, () => this.bumpRevision());
    }

    moveFrame(direction) {
        let frames = this.getSelectedLayerFrames();
        let current = this.state.selectedFrame;
        if (!frames || !current) return;

        let idx = frames.indexOf(current);
        let target = idx + direction;
        if (idx < 0 || target < 0 || target >= frames.length) return;

        [frames[idx], frames[target]] = [frames[target], frames[idx]];
        this.recomputeFrameOffsets(frames);
        this.bumpRevision();
    }

    // --- Export -----------------------------------------------------------

    downloadAnimationJson() {
        if (!this.animData) return;
        let blob = new Blob([JSON.stringify(this.animData, null, 2)], { type: 'application/json' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = 'Animation.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    // --- Drawing ------------------------------------------------------------

    drawSprite(ctx, rect, matrix) {
        let img = this.image;
        if (!img) return;

        ctx.save();
        ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);

        if (rect.rotated) {
            // Atlas stores the packed (rotated) footprint w x h; the original
            // sprite is h x w. Same rotate-then-draw approach SpritesPlayer.jsx
            // uses for this app's own output - kept consistent, though this
            // atlas comes from a different exporter (Adobe Animate/BetterTA)
            // whose rotation convention hasn't been independently confirmed to
            // match; flag any visibly wrong rotated part as a follow-up.
            ctx.translate(rect.h / 2, rect.w / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
        } else {
            ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        }

        ctx.restore();
    }

    drawGizmo(ctx, entry) {
        let rect = this.spriteRects.get(entry.spriteName);
        if (!rect) return;
        let w = rect.rotated ? rect.h : rect.w;
        let h = rect.rotated ? rect.w : rect.h;

        ctx.save();
        ctx.transform(entry.matrix[0], entry.matrix[1], entry.matrix[2], entry.matrix[3], entry.matrix[4], entry.matrix[5]);

        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2 / this.state.zoom;
        ctx.setLineDash([5 / this.state.zoom, 3 / this.state.zoom]);
        ctx.strokeRect(0, 0, w, h);
        ctx.setLineDash([]);

        ctx.fillStyle = '#4a9eff';
        let hs = HANDLE_SIZE / this.state.zoom;

        // Rotate handle
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, -ROTATE_HANDLE_OFFSET / this.state.zoom);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(w / 2, -ROTATE_HANDLE_OFFSET / this.state.zoom, hs / 2, 0, Math.PI * 2);
        ctx.fill();

        // Scale handle (bottom-right corner)
        ctx.fillRect(w - hs / 2, h - hs / 2, hs, hs);

        ctx.restore();
    }

    renderFrame() {
        let canvas = this.canvasRef.current;
        if (!canvas || !this.animData) return;

        let ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;

        // Stage origin: Animate places symbol instances relative to a
        // center-ish stage origin in every real export seen so far - center
        // the canvas so typical MX translations land on-screen instead of
        // off in the corner.
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);

        let drawList = AnimationRenderer.computeDrawList(this.animData, Math.floor(this.state.tick));
        this.lastDrawList = drawList;
        for (let entry of drawList) {
            let rect = this.spriteRects.get(entry.spriteName);
            if (!rect) continue; // sprite referenced but not in this spritemap - skip rather than crash
            this.drawSprite(ctx, rect, entry.matrix);
        }

        if (this.state.editMode) {
            let selected = this.getSelectedEntry();
            if (selected) this.drawGizmo(ctx, selected);
        }

        ctx.restore();
    }

    render() {
        let { textureLoaded, spritemapLoaded, animationLoaded, error, playing, tick, selectedState, zoom, editMode } = this.state;

        let allLoaded = textureLoaded && spritemapLoaded && animationLoaded;
        let canvasW = this.animData?.MD?.W || 1280;
        let canvasH = this.animData?.MD?.H || 720;

        let { start, duration } = allLoaded ? this.getActiveRange() : { start: 0, duration: 1 };
        let localTick = Math.floor(tick) - start;

        let selectedEntry = allLoaded ? this.getSelectedEntry() : null;
        let selectedFrames = this.getSelectedLayerFrames();
        let selectedFrameIdx = selectedFrames ? selectedFrames.indexOf(this.state.selectedFrame) : -1;

        return (
            <div className="sheet-splitter-shader">
                <div className="sheet-splitter-content animation-preview-content">
                    <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: '8px' }}>
                        🎬 {I18.f("ANIMATE_PREVIEW")} <span style={{ fontWeight: 'normal', fontSize: '11px', opacity: 0.7 }}>(experimental)</span>
                    </div>

                    <table style={{ margin: '0 auto 10px' }}>
                        <tbody>
                            <tr>
                                <td>
                                    <div className="btn back-800 border-color-gray color-white file-upload">
                                        Textura (PNG)
                                        <input type="file" accept="image/png" onChange={this.selectTexture} />
                                    </div>
                                </td>
                                <td>
                                    <div className="btn back-800 border-color-gray color-white file-upload">
                                        spritemap.json
                                        <input type="file" accept=".json" onChange={this.selectSpritemap} />
                                    </div>
                                </td>
                                <td>
                                    <div className="btn back-800 border-color-gray color-white file-upload">
                                        Animation.json
                                        <input type="file" accept=".json" onChange={this.selectAnimation} />
                                    </div>
                                </td>
                                <td>
                                    <div
                                        className={"btn border-color-gray color-white" + (editMode ? "" : " back-800")}
                                        style={editMode ? { background: '#4a9eff' } : {}}
                                        onClick={this.toggleEditMode}
                                    >
                                        {editMode ? '✓ Editando' : '✎ Editar'}
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    {error && <div style={{ color: '#ff6b6b', textAlign: 'center', marginBottom: '8px' }}>⚠ {error}</div>}

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{
                            flex: 1,
                            height: '380px',
                            overflow: 'auto',
                            border: '1px solid var(--border-color)',
                            background: '#1a1a2e',
                            textAlign: 'center'
                        }}>
                            <canvas
                                ref={this.canvasRef}
                                width={canvasW}
                                height={canvasH}
                                onMouseDown={this.onCanvasMouseDown}
                                style={{
                                    imageRendering: 'pixelated',
                                    transform: `scale(${zoom})`,
                                    transformOrigin: 'top left',
                                    marginTop: '10px',
                                    cursor: editMode ? 'crosshair' : 'default'
                                }}
                            />
                        </div>

                        {editMode && (
                            <div style={{ width: '190px', fontSize: '12px', overflowY: 'auto' }}>
                                {!selectedEntry && <div style={{ opacity: 0.6, padding: '8px' }}>Hacé click en un sprite del canvas para seleccionarlo.</div>}
                                {selectedEntry && (
                                    <div style={{ padding: '4px' }}>
                                        <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
                                            Sprite: {selectedEntry.spriteName}
                                        </div>

                                        {selectedEntry.kind === 'ASI' && (
                                            <div style={{ marginBottom: '10px' }}>
                                                <label>Reasignar sprite:</label><br/>
                                                <select
                                                    value={selectedEntry.spriteName}
                                                    onChange={this.onReassignSprite}
                                                    style={{ width: '100%' }}
                                                >
                                                    {[...this.spriteRects.keys()].map(name => (
                                                        <option key={name} value={name}>{name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {selectedFrames && (
                                            <div>
                                                <div style={{ marginBottom: '4px' }}>
                                                    Frame {selectedFrameIdx + 1} / {selectedFrames.length}
                                                </div>
                                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                    <button onClick={this.addFrame} title="Duplicar este frame">+ Frame</button>
                                                    <button onClick={this.deleteFrame} title="Borrar este frame">🗑 Frame</button>
                                                    <button onClick={() => this.moveFrame(-1)} title="Mover antes">↑</button>
                                                    <button onClick={() => this.moveFrame(1)} title="Mover después">↓</button>
                                                </div>
                                            </div>
                                        )}

                                        <div style={{ marginTop: '10px', opacity: 0.7, fontSize: '11px' }}>
                                            Arrastrá el sprite para mover, el mango de arriba para rotar, la esquina para escalar.
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button
                            className="btn back-800 border-color-gray color-white"
                            disabled={!allLoaded}
                            onClick={this.togglePlay}
                        >
                            {playing ? '⏹ Stop' : '▶ Play'}
                        </button>

                        <select disabled={!allLoaded} value={selectedState} onChange={this.onStateChange}>
                            <option value="all">Timeline completa ({this.rootDuration} frames)</option>
                            {this.namedStates.map(s => (
                                <option key={s.name} value={s.name}>{s.name} ({s.duration} frames)</option>
                            ))}
                        </select>

                        <input
                            type="range"
                            min="0"
                            max={Math.max(0, duration - 1)}
                            value={Math.max(0, Math.min(localTick, duration - 1))}
                            disabled={!allLoaded}
                            onChange={this.onScrub}
                            style={{ width: '160px' }}
                        />
                        <span style={{ fontSize: '12px', minWidth: '60px' }}>
                            {Math.max(0, localTick) + 1} / {duration}
                        </span>

                        <label style={{ fontSize: '12px' }}>
                            Zoom:
                            <input
                                type="range" min="0.25" max="2" step="0.25" value={zoom}
                                onChange={e => this.setState({ zoom: Number(e.target.value) })}
                                style={{ width: '70px', marginLeft: '6px' }}
                            />
                        </label>

                        <div className="btn back-800 border-color-gray color-white" onClick={this.downloadAnimationJson} title="Descarga el Animation.json con tus ediciones">
                            💾 Descargar
                        </div>
                    </div>

                    <div style={{ textAlign: 'center', marginTop: '12px' }}>
                        <div className="btn back-800 border-color-gray color-white" onClick={this.close}>{I18.f("CLOSE")}</div>
                    </div>
                </div>
            </div>
        );
    }
}

export default AnimationPreviewTool;
