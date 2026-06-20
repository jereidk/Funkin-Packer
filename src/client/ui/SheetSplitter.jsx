import React from 'react';

import {Observer, GLOBAL_EVENT} from '../Observer';
import I18 from '../utils/I18';

import splitters, {getSplitterByData, getSplitterByType} from '../splitters';
import {getDefaultSplitter} from '../splitters';
import LocalImagesLoader from "../utils/LocalImagesLoader";
import ReactDOM from "react-dom";
import Downloader from "platform/Downloader";
import ImagesList from "./ImagesList.jsx";
import { cleanPrefix } from '../utils/common';
import sparrowStore from '../store/sparrowStore';
import { getAnimationLinker } from '../utils/AnimationLinker';
import animationOptionsStore from '../store/animationOptionsStore';
import AnimationTreeView from './AnimationTreeView.jsx';

class SheetSplitter extends React.Component {
    constructor(props) {
        super(props);

        this.textureBackColors = ["grid-back", "white-back", "pink-back", "black-back"];
        this.step = 0.1;

        this.state = {
            splitter: getDefaultSplitter(),
            textureBack: this.textureBackColors[0],
            scale: 1
        };

        this.rangeRef = React.createRef();
        this.wheelRef = React.createRef();

        this.texture = null;
        this.data = null;
        this.frames = null;

        this.textureName = '';
        this.dataName = '';
        this.animationFileName = '';
        
        // Auto-fill names for export
        this.exportName = '';
        this.zipName = '';

        this.buffer = document.createElement('canvas');
        // Use default alpha:true to preserve transparency in extracted frames
        this.bufferCtx = this.buffer.getContext('2d');

        this.doExport = this.doExport.bind(this);
        this.doRepack = this.doRepack.bind(this);
        this.selectTexture = this.selectTexture.bind(this);
        this.selectDataFile = this.selectDataFile.bind(this);
        this.selectAnimationFile = this.selectAnimationFile.bind(this);
        this.onGenerateAnimationChanged = this.onGenerateAnimationChanged.bind(this);
        this.updateFrames = this.updateFrames.bind(this);
        this.updateView = this.updateView.bind(this);
        this.changeSplitter = this.changeSplitter.bind(this);
        this.setBack = this.setBack.bind(this);
        this.changeScale = this.changeScale.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
    }

    componentDidMount() {
        this.updateTexture();
        this.wheelRef.current.addEventListener('wheel', this.handleWheel, { passive: false });
    }

    handleWheel(event) {
        if(!event.ctrlKey) return;

        let value = this.state.scale;
        if (event.deltaY >= 0) {
            if (this.state.scale > 0.1) {
                value = Number((this.state.scale - this.step).toPrecision(2));
                this.setState({scale: value});
                this.updateTextureScale(value);
            }
        } else {
            if (this.state.scale < 2.0) {
                value = Number((this.state.scale + this.step).toPrecision(2));
                this.setState({scale: value});
                this.updateTextureScale(value);
            }
        }

        // update range component
        this.rangeRef.current.value = value;

        event.preventDefault();
        event.stopPropagation();
        return false;
    }

    doRepack() {
        Observer.emit(GLOBAL_EVENT.SHOW_SHADER);

        if(!this.frames || !this.frames.length) {
            Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
            Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, I18.f('SPLITTER_ERROR_NO_FRAMES'));

            return;
        }

        let ctx = this.bufferCtx;
        let files = [];

        let disableuntrim = ReactDOM.findDOMNode(this.refs.disableuntrim).checked;

        for(let item of this.frames) {
            let trimmed = item.trimmed ? disableuntrim : false;

            var prefix = cleanPrefix(item.originalFile || item.file || item.name);

            var ssw = item.sourceSize.w;
            var ssh = item.sourceSize.h;

            var maxMap = sparrowStore.getMaxMapEntry(prefix);
            if (maxMap) {
                ssw = maxMap.mw;
                ssh = maxMap.mh;
            }

            this.buffer.width = (disableuntrim && trimmed) ? item.spriteSourceSize.w : ssw;
            this.buffer.height = (disableuntrim && trimmed) ? item.spriteSourceSize.h : ssh;

            var isEmpty = this.buffer.width === 0 || this.buffer.height === 0;

            if(isEmpty) {
                //console.log(item);
                this.buffer.width = 1;
                this.buffer.height = 1;
            }

            ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);

            if(!isEmpty) {
                if(item.rotated) {
                    ctx.save();

                    ctx.translate(item.spriteSourceSize.x + item.spriteSourceSize.w/2, item.spriteSourceSize.y + item.spriteSourceSize.h/2);
                    ctx.rotate(this.state.splitter.inverseRotation ? Math.PI/2 : -Math.PI/2);

                    let dx = trimmed ? item.spriteSourceSize.y - item.spriteSourceSize.h/2 : -item.spriteSourceSize.h/2;
                    let dy = trimmed ? -(item.spriteSourceSize.x + item.spriteSourceSize.w/2) : -item.spriteSourceSize.w/2;

                    ctx.drawImage(this.texture,
                        item.frame.x, item.frame.y,
                        item.frame.h, item.frame.w,
                        dx, dy,
                        item.spriteSourceSize.h, item.spriteSourceSize.w);

                    ctx.restore();
                } else {
                    let dx = trimmed ? 0 : item.spriteSourceSize.x;
                    let dy = trimmed ? 0 : item.spriteSourceSize.y;

                    ctx.drawImage(this.texture,
                        item.frame.x, item.frame.y,
                        item.frame.w, item.frame.h,
                        dx, dy,
                        item.spriteSourceSize.w, item.spriteSourceSize.h);
                }
            }

            let ext = item.name.split('.').pop().toLowerCase();
            // Force PNG format to preserve transparency in extracted frames
            // Atlas sprites typically have alpha channel that would be lost with JPEG
            let forcePng = ['jpg', 'jpeg', 'jpng'].includes(ext);
            if(forcePng || !ext) {
                ext = 'png';
                item.name += '.' + ext;
            }

            let base64 = this.buffer.toDataURL('image/png').split(',').pop();

            files.push({
                name: item.name,
                content: base64,
                base64: base64
            });
        }

        //console.log(ImagesList.i);
        var images = [];

        for(let file of files) {
            var image = new Image();
            // Reconstruct data URL for image src (needs full data: URL for loading)
            image.src = 'data:image/png;base64,' + file.base64;
            image._base64 = file.base64;

            images[file.name] = image;

            //ImagesList.i.state.images[file.name] = image;
        }

        ImagesList.i.loadImagesComplete(images);

        //Downloader.run(files, this.textureName + '.zip');

        Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
        Observer.emit(GLOBAL_EVENT.HIDE_SHEET_SPLITTER); // Close the spritesheet splitter
        Observer.emit(GLOBAL_EVENT.IMAGES_LIST_CHANGED, ImagesList.i.state.images);
    }

    doExport() {
        Observer.emit(GLOBAL_EVENT.SHOW_SHADER);

        if(!this.frames || !this.frames.length) {
            Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
            Observer.emit(GLOBAL_EVENT.SHOW_MESSAGE, I18.f('SPLITTER_ERROR_NO_FRAMES'));

            return;
        }

        let ctx = this.bufferCtx;
        let files = [];

        let disableuntrim = ReactDOM.findDOMNode(this.refs.disableuntrim).checked;

        for(let item of this.frames) {
            let trimmed = item.trimmed ? disableuntrim : false;

            var prefix = cleanPrefix(item.originalFile || item.file || item.name);

            var ssw = item.sourceSize.w;
            var ssh = item.sourceSize.h;

            var maxMap = sparrowStore.getMaxMapEntry(prefix);
            if (maxMap) {
                ssw = maxMap.mw;
                ssh = maxMap.mh;
            }

            this.buffer.width = (disableuntrim && trimmed) ? item.spriteSourceSize.w : ssw;
            this.buffer.height = (disableuntrim && trimmed) ? item.spriteSourceSize.h : ssh;

            ctx.clearRect(0, 0, this.buffer.width, this.buffer.height);

            if(item.rotated) {
                ctx.save();

                ctx.translate(item.spriteSourceSize.x + item.spriteSourceSize.w/2, item.spriteSourceSize.y + item.spriteSourceSize.h/2);
                ctx.rotate(this.state.splitter.inverseRotation ? Math.PI/2 : -Math.PI/2);

                let dx = trimmed ? item.spriteSourceSize.y - item.spriteSourceSize.h/2 : -item.spriteSourceSize.h/2;
                let dy = trimmed ? -(item.spriteSourceSize.x + item.spriteSourceSize.w/2) : -item.spriteSourceSize.w/2;

                ctx.drawImage(this.texture,
                    item.frame.x, item.frame.y,
                    item.frame.h, item.frame.w,
                    dx, dy,
                    item.spriteSourceSize.h, item.spriteSourceSize.w);

                ctx.restore();
            }
            else {

                let dx = trimmed ? 0 : item.spriteSourceSize.x;
                let dy = trimmed ? 0 : item.spriteSourceSize.y;

                ctx.drawImage(this.texture,
                    item.frame.x, item.frame.y,
                    item.frame.w, item.frame.h,
                    dx, dy,
                    item.spriteSourceSize.w, item.spriteSourceSize.h);
            }

            let ext = item.name.split('.').pop().toLowerCase();
            // Force PNG format to preserve transparency in extracted frames
            // Atlas sprites typically have alpha channel that would be lost with JPEG
            let forcePng = ['jpg', 'jpeg', 'jpng'].includes(ext);
            if(forcePng || !ext) {
                ext = 'png';
                item.name += '.' + ext;
            }

            let base64 = this.buffer.toDataURL('image/png');
            base64 = base64.split(',').pop();

            files.push({
                name: item.name,
                content: base64,
                base64: base64
            });
        }

        // Use custom export name if provided, otherwise fallback to texture name
        let exportName = this.exportNameInput ? this.exportNameInput.value : this.textureName;
        let zipName = this.zipNameInput ? this.zipNameInput.value : this.textureName;
        
        Downloader.run(files, zipName + '.zip');

        Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
    }

    selectTexture(e) {
        // Save values before async operations - e.target becomes null after handler
        const files = e.target.files;
        
        if(files && files.length) {
            Observer.emit(GLOBAL_EVENT.SHOW_SHADER);
            console.log('[SheetSplitter] Loading texture:', files[0].name);

            const fileName = files[0].name;
            
            let loader = new LocalImagesLoader();
            loader.load(
                files, 
                null, 
                data => {
                    console.log('[SheetSplitter] Texture loaded, data keys:', Object.keys(data));
                    let keys = Object.keys(data);

                    if (keys.length === 0) {
                        console.error('[SheetSplitter] No images loaded!');
                        Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
                        return;
                    }

                    this.textureName = keys[0];

                    this.texture = data[this.textureName];
                    ReactDOM.findDOMNode(this.refs.textureName).textContent = this.textureName;

                    // Auto-fill export/zip names from PNG filename if inputs are empty
                    // This preserves user edits (e.g., if they already typed something or loaded a data file first)
                    let baseName = fileName.replace(/\.[^.]+$/, '');
                    if (!this.exportNameInput || !this.exportNameInput.value.trim()) {
                        this.exportName = baseName;
                        if (this.exportNameInput) {
                            this.exportNameInput.value = baseName;
                        }
                    }
                    if (!this.zipNameInput || !this.zipNameInput.value.trim()) {
                        this.zipName = baseName;
                        if (this.zipNameInput) {
                            this.zipNameInput.value = baseName;
                        }
                    }

                    this.updateView();

                    Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
                },
                (loadFileName, error) => {
                    console.error('[SheetSplitter] Error loading texture:', loadFileName, error);
                    Observer.emit(GLOBAL_EVENT.HIDE_SHADER);
                }
            );
        }
    }

    updateTexture() {
        let canvas = ReactDOM.findDOMNode(this.refs.view);

        if(this.texture) {
            canvas.width = this.texture.width;
            canvas.height = this.texture.height;
            canvas.style.display = '';

            let ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(this.texture, 0, 0);

            canvas.className = this.state.textureBack;
            this.updateTextureScale();
        }
        else {
            canvas.style.display = 'none';
        }
    }

    selectDataFile(e) {
        if(e.target.files.length) {
            let item = e.target.files[0];

            let reader = new FileReader();
            reader.onload = e => {

                let content = e.target.result;
                content = content.split(',');
                content.shift();
                content = atob(content);

                this.data = content;

                this.dataName = item.name;
                ReactDOM.findDOMNode(this.refs.dataFileName).textContent = this.dataName;

                // Auto-fill export names from data file name (e.g., "myAtlas.xml" -> "myAtlas")
                // Only if inputs are empty to preserve user edits (e.g., if they already loaded PNG first)
                let baseName = item.name.replace(/\.[^.]+$/, '');
                if (!this.exportNameInput || !this.exportNameInput.value.trim()) {
                    this.exportName = baseName;
                    if (this.exportNameInput) {
                        this.exportNameInput.value = baseName;
                    }
                }
                if (!this.zipNameInput || !this.zipNameInput.value.trim()) {
                    this.zipName = baseName;
                    if (this.zipNameInput) {
                        this.zipNameInput.value = baseName;
                    }
                }

                getSplitterByData(this.data, (splitter) => {
                    this.setState({splitter: splitter});
                    this.updateView();
                });
            };

            reader.readAsDataURL(item);
        }
    }

    selectAnimationFile(e) {
        if(e.target.files.length) {
            let item = e.target.files[0];

            let reader = new FileReader();
            reader.onload = e => {
                let content = e.target.result;
                content = content.split(',');
                content.shift();
                content = atob(content);

                // Load Animation.json into AnimationLinker
                let animLinker = getAnimationLinker();
                let success = animLinker.loadAnimation(content);

                this.animationFileName = item.name;
                ReactDOM.findDOMNode(this.refs.animationFileName).textContent = 
                    success ? this.animationFileName + ' ✓' : this.animationFileName + ' ✗';

                if (success) {
                    let refs = animLinker.getReferencedSprites();
                    let syms = animLinker.getReferencedSymbols();
                    let orphans = animLinker.validateExistence(this.frames || []);
                    console.log('AnimationLinker: Loaded', refs.length, 'sprites,', syms.length, 'symbols from Animation.json');
                    
                    // Update display with stats
                    ReactDOM.findDOMNode(this.refs.animationFileName).textContent = 
                        this.animationFileName + ' ✓ — ' + syms.length + ' symbols, ' + refs.length + ' sprites' +
                        (orphans.total > 0 ? ', ⚠ ' + orphans.total + ' orphaned' : '');
                }
            };

            reader.readAsDataURL(item);
        }
    }

    onGenerateAnimationChanged(e) {
        animationOptionsStore.setGenerateAnimation(e.target.checked);
    }

    updateFrames() {
        if(!this.texture) return;

        this.state.splitter.split(this.data, {
            textureWidth: this.texture.width,
            textureHeight: this.texture.height,
            width: ReactDOM.findDOMNode(this.refs.width).value * 1 || 32,
            height: ReactDOM.findDOMNode(this.refs.height).value * 1 || 32,
            padding: ReactDOM.findDOMNode(this.refs.padding).value * 1 || 0
        }, frames => {
            if(frames) {
                this.frames = frames;
                
                // Force re-render to update AnimationTreeView with new frames
                this.forceUpdate();

                let canvas = ReactDOM.findDOMNode(this.refs.view);
                let ctx = canvas.getContext('2d');

                for(let item of this.frames) {
                    let frame = item.frame;

                    let w = frame.w, h = frame.h;
                    if(item.rotated) {
                        w = frame.h;
                        h = frame.w;
                    }

                    ctx.strokeStyle = "#00F";
                    ctx.fillStyle = "rgba(0,0,255,0.25)";
                    ctx.lineWidth = 1;

                    ctx.beginPath();
                    ctx.fillRect(frame.x, frame.y, w, h);
                    ctx.rect(frame.x, frame.y, w, h);
                    ctx.moveTo(frame.x, frame.y);
                    ctx.lineTo(frame.x + w, frame.y + h);
                    ctx.stroke();

                }

            }
        });
    }

    updateView() {
        this.updateTexture();
        this.updateFrames();
    }

    changeSplitter(e) {
        let splitter = getSplitterByType(e.target.value);

        this.state.splitter = splitter;

        this.setState({splitter: splitter});
        this.updateView();
    }

    setBack(e) {
        let classNames = e.target.className.split(" ");
        for(let name of classNames) {
            if(this.textureBackColors.indexOf(name) >= 0) {
                this.setState({textureBack: name});

                let canvas = ReactDOM.findDOMNode(this.refs.view);
                canvas.className = name;

                return;
            }
        }
    }

    updateTextureScale(val=this.state.scale) {
        if(this.texture) {
            let w = Math.floor(this.texture.width * val);
            let h = Math.floor(this.texture.height * val);

            let canvas = ReactDOM.findDOMNode(this.refs.view);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
        }
    }

    changeScale(e) {
        let val = Number(e.target.value);
        this.setState({scale: val});
        this.updateTextureScale(val);
    }

    close() {
        Observer.emit(GLOBAL_EVENT.HIDE_SHEET_SPLITTER);
    }

    render() {
        let displayType = this.state.splitter.type;

        let displayGridProperties = 'none';

        switch (displayType) {
            case "Grid": {
                displayGridProperties = '';
                break;
            }
        }

        // Show Animation.json selector for BetterTA format
        let isBetterTA = displayType === 'BetterTA';
        let animationFileStyle = isBetterTA ? {} : { display: 'none' };

        return (
            <div className="sheet-splitter-shader">
                <div className="sheet-splitter-content">
                    <div className="sheet-splitter-top">
                        <table>
                            <tbody>
                                <tr>
                                    <td>
                                        <div className="btn back-800 border-color-gray color-white file-upload">
                                            {I18.f("SELECT_TEXTURE")}
                                            <input type="file" ref="selectTextureInput" accept="image/png,image/jpg,image/jpeg,image/gif" onChange={this.selectTexture} />
                                        </div>
                                    </td>
                                    <td>
                                        <div className="back-400 border-color-gray color-black sheet-splitter-info-text" ref="textureName">&nbsp;</div>
                                    </td>
                                    <td>
                                        <div className="btn back-800 border-color-gray color-white file-upload">
                                            {I18.f("SELECT_DATA_FILE")}
                                            <input type="file" onChange={this.selectDataFile} />
                                        </div>
                                    </td>
                                    <td>
                                        <div className="back-400 border-color-gray color-black sheet-splitter-info-text" ref="dataFileName">&nbsp;</div>
                                    </td>
                                </tr>
                                {/* Animation.json selector - only shown for BetterTA */}
                                <tr style={animationFileStyle}>
                                    <td colSpan="4" style={{ paddingTop: '8px' }}>
                                        <div className="btn back-600 border-color-gray color-white file-upload" style={{ display: 'inline-block' }}>
                                            Select Animation.json (Optional)
                                            <input type="file" accept=".json" onChange={this.selectAnimationFile} />
                                        </div>
                                        <span className="back-400 border-color-gray color-black sheet-splitter-info-text" 
                                              ref="animationFileName" 
                                              style={{ marginLeft: '10px', padding: '4px 8px' }}>
                                            &nbsp;
                                        </span>
                                    </td>
                                </tr>
                                {/* Generate Animation.json option - shown for BetterTA when no Animation.json loaded */}
                                <tr ref="generateAnimRow" style={animationFileStyle}>
                                    <td colSpan="4" style={{ paddingTop: '4px' }}>
                                        <label style={{ color: '#a8d4ff', fontSize: '12px', cursor: 'pointer' }}>
                                            <input 
                                                ref="generateAnimationJson" 
                                                type="checkbox" 
                                                style={{ marginRight: '6px' }}
                                                onChange={this.onGenerateAnimationChanged}
                                            />
                                            Generate Animation.json from sprite names (opt-in)
                                        </label>
                                        <span style={{ marginLeft: '10px', color: '#888', fontSize: '11px' }}>
                                            Creates animation from frame sequences (idle_0, idle_1...)
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div ref={this.wheelRef} className="sheet-splitter-view">
                        <canvas ref='view'/>
                    </div>

                    <div className="sheet-splitter-controls">
                        <table>
                            <tbody>
                                <tr>
                                    <td>{I18.f('FORMAT')}</td>
                                    <td>
                                        <select ref="dataFormat" className="border-color-gray" value={this.state.splitter.type} onChange={this.changeSplitter}>
                                            {splitters.map(node => {
                                                return (<option key={"data-format-" + node.type} defaultValue={node.type}>{node.type}</option>)
                                            })}
                                        </select>
                                    </td>
                                </tr>
                                <tr>
                                    <td>Nombre Export:</td>
                                    <td>
                                        <input 
                                            ref={el => this.exportNameInput = el} 
                                            type="text" 
                                            className="border-color-gray"
                                            placeholder="Nombre del sprite"
                                            style={{width: '100px'}}
                                        />
                                    </td>
                                </tr>
                                <tr>
                                    <td>Nombre ZIP:</td>
                                    <td>
                                        <input 
                                            ref={el => this.zipNameInput = el} 
                                            type="text" 
                                            className="border-color-gray"
                                            placeholder="Nombre del ZIP"
                                            style={{width: '100px'}}
                                        />
                                    </td>
                                </tr>
                                <tr>
                                    <td>{I18.f('DISABLE_UNTRIM')}</td>
                                    <td>
                                        <input ref="disableuntrim" type="checkbox" className="border-color-gray"/>
                                    </td>
                                </tr>
                                <tr style={{display: displayGridProperties}}>
                                    <td>{I18.f('WIDTH')}</td>
                                    <td>
                                        <input type="number" ref='width' defaultValue='64' onChange={this.updateView}/>
                                    </td>
                                </tr>
                                <tr style={{display: displayGridProperties}}>
                                    <td>{I18.f('HEIGHT')}</td>
                                    <td>
                                        <input type="number" ref='height' defaultValue='64' onChange={this.updateView}/>
                                    </td>
                                </tr>
                                <tr style={{display: displayGridProperties}}>
                                    <td>{I18.f('PADDING')}</td>
                                    <td>
                                        <input type="number" ref='padding' defaultValue='0' onChange={this.updateView}/>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    
                    {/* Animation Tree View - shown when Animation.json loaded */}
                    {isBetterTA && (
                        <div ref="animationTreeContainer" style={{ marginTop: '10px' }}>
                            <AnimationTreeView frames={this.frames} />
                        </div>
                    )}

                    <div className="sheet-splitter-bottom">
                        <table>
                            <tbody>
                                <tr>
                                    {this.textureBackColors.map(name => {
                                        return (
                                            <td key={"back-color-btn-" + name}>
                                                <div className={"btn-back-color " + name + (this.state.textureBack === name ? " selected" : "")} onClick={this.setBack}>&nbsp;</div>
                                            </td>
                                        )
                                    })}

                                    <td>
                                        {I18.f("SCALE")}
                                    </td>
                                    <td>
                                        <input ref={this.rangeRef} type="range" min="0.1" max="2" step={this.step} defaultValue="1" onChange={this.changeScale}/>
                                    </td>
                                </tr>
                            </tbody>
                        </table>

                        <div>
                            <div className="btn back-800 border-color-gray color-white" onClick={this.doRepack}>{I18.f("REPACK")}</div>
                            <div className="btn back-800 border-color-gray color-white" onClick={this.doExport}>{I18.f("EXPORT")}</div>
                            <div className="btn back-800 border-color-gray color-white" onClick={this.close}>{I18.f("CLOSE")}</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default SheetSplitter;
