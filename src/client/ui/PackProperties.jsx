import React from 'react';
import ReactDOM from 'react-dom';

import Storage from '../utils/Storage';

import exporters from '../exporters';
import { getExporterByType } from '../exporters';
import packers from '../packers';
import { getPackerByType } from '../packers';
import filters from '../filters';
import { getFilterByType } from '../filters';

import I18 from '../utils/I18';

import {Observer, GLOBAL_EVENT} from '../Observer';

import FileSystem from 'platform/FileSystem';
import sparrowStore from '../store/sparrowStore';
import SmartSizePreview from './SmartSizePreview.jsx';

const STORAGE_OPTIONS_KEY = "pack-options";
const STORAGE_CUSTOM_EXPORTER_KEY = "custom-exporter";

let INSTANCE = null;

class PackProperties extends React.Component {
    constructor(props) {
        super(props);

        INSTANCE = this;

        this.onPackerChange = this.onPackerChange.bind(this);
        this.onPropChanged = this.onPropChanged.bind(this);
        this.onExporterChanged = this.onExporterChanged.bind(this);
        this.onExporterPropChanged = this.onExporterPropChanged.bind(this);
        this.onEnterKeyCommit = this.onEnterKeyCommit.bind(this);
        this.selectSavePath = this.selectSavePath.bind(this);

        this.packOptions = this.loadOptions();
        this.loadCustomExporter();

        window.applyOptionsDefaults = this.applyOptionsDefaults;

        this.state = {packer: this.packOptions.packer};
    }

    static get i() {
        return INSTANCE;
    }

    setOptions(data) {
        this.packOptions = this.applyOptionsDefaults(data);
        this.saveOptions();
        this.refreshPackOptions();
        this.emitChanges();
    }

    loadCustomExporter() {
        let data = Storage.load(STORAGE_CUSTOM_EXPORTER_KEY);
        if(data) {
            let exporter = getExporterByType("custom");
            exporter.allowTrim = data.allowTrim;
            exporter.allowRotation = data.allowRotation;
            exporter.fileExt = data.fileExt;
            exporter.content = data.content;
        }
    }

    loadOptions() {
        return this.applyOptionsDefaults(Storage.load(STORAGE_OPTIONS_KEY));
    }

    applyOptionsDefaults(data) {
        if(!data) data = {};

        data.textureName = data.textureName || "texture";
        data.textureFormat = data.textureFormat || "png";
        data.compressPng = data.compressPng === undefined ? false : data.compressPng;
        data.compressPngQuality = data.compressPngQuality !== undefined ? data.compressPngQuality : 0.8;
        data.compressPngStripMeta = data.compressPngStripMeta === undefined ? false : data.compressPngStripMeta;
        data.removeFileExtension = data.removeFileExtension === undefined ? true : data.removeFileExtension;
        data.prependFolderName = data.prependFolderName === undefined ? true : data.prependFolderName;
        data.scale = data.scale || 1;
        data.filter = getFilterByType(data.filter) ? data.filter : filters[0].type;
        data.exporter = getExporterByType(data.exporter) ? data.exporter : exporters[0].type;
        data.base64Export = data.base64Export === undefined ? false : data.base64Export;
        //data.tinify = data.tinify === undefined ? false : data.tinify;
        //data.tinifyKey = data.tinifyKey === undefined ? "" : data.tinifyKey;
        data.fileName = data.fileName || "pack-result";
        data.savePath = data.savePath || "";
        data.width = data.width === undefined ? 8192 : data.width;
        data.height = data.height === undefined ? 8192 : data.height;
        data.fixedSize = data.fixedSize === undefined ? false : data.fixedSize;
        data.powerOfTwo = data.powerOfTwo === undefined ? false : data.powerOfTwo;
        data.spritePadding = data.spritePadding === undefined ? 0 : data.spritePadding;
        data.borderPadding = data.borderPadding === undefined ? 0 : data.borderPadding;
        data.allowRotation = data.allowRotation === undefined ? false : data.allowRotation;
        data.allowTrim = data.allowTrim === undefined ? true : data.allowTrim;
        data.solverMode = data.solverMode || 'manual';
        data.disableMaxLimit = data.disableMaxLimit === undefined ? false : data.disableMaxLimit;
        data.packingAlgorithm = data.packingAlgorithm || 'best';
        data.trimMode = data.trimMode === undefined ? "trim" : data.trimMode;
        data.alphaThreshold = data.alphaThreshold || 0;
        data.detectIdentical = data.detectIdentical === undefined ? true : data.detectIdentical;
        data.sortExportedRows = data.sortExportedRows === undefined ? true : data.sortExportedRows;
        data.packer = getPackerByType(data.packer) ? data.packer : packers[2].type;

        let methodValid = false;
        let packer = getPackerByType(data.packer);
        let packerMethods = Object.keys(packer.methods);
        for(let method of packerMethods) {
            if(method === data.packerMethod) {
                methodValid = true;
                break;
            }
        }

        if(!methodValid) data.packerMethod = packerMethods[0];

        return data;
    }

    saveOptions(force=false) {
        if(PLATFORM === "web" || force) {
            Storage.save(STORAGE_OPTIONS_KEY, this.packOptions);
        }
    }

    componentDidMount() {
        this.updateEditCustomTemplateButton();
        this.emitChanges();
    }

    updatePackOptions() {
        let data = {};

        data.textureName = ReactDOM.findDOMNode(this.refs.textureName).value;
        data.textureFormat = ReactDOM.findDOMNode(this.refs.textureFormat).value;

        // PNG compression options
        if (this.refs.compressPng) {
            data.compressPng = ReactDOM.findDOMNode(this.refs.compressPng).checked;
        }
        if (this.refs.compressPngQuality) {
            data.compressPngQuality = Number(ReactDOM.findDOMNode(this.refs.compressPngQuality).value);
        }
        if (this.refs.compressPngStripMeta) {
            data.compressPngStripMeta = ReactDOM.findDOMNode(this.refs.compressPngStripMeta).checked;
        }
        
        // ASTC options
        if (this.refs.astcBlockSize) {
            data.astcBlockSize = ReactDOM.findDOMNode(this.refs.astcBlockSize).value;
        }
        if (this.refs.astcQuality) {
            data.astcQuality = ReactDOM.findDOMNode(this.refs.astcQuality).value;
        }
        
        data.removeFileExtension = ReactDOM.findDOMNode(this.refs.removeFileExtension).checked;
        data.prependFolderName = ReactDOM.findDOMNode(this.refs.prependFolderName).checked;
        data.base64Export = ReactDOM.findDOMNode(this.refs.base64Export).checked;
        //data.tinify = ReactDOM.findDOMNode(this.refs.tinify).checked;
        //data.tinifyKey = ReactDOM.findDOMNode(this.refs.tinifyKey).value;
        data.scale = Number(ReactDOM.findDOMNode(this.refs.scale).value);
        data.filter = ReactDOM.findDOMNode(this.refs.filter).value;
        data.exporter = ReactDOM.findDOMNode(this.refs.exporter).value;
        data.fileName = ReactDOM.findDOMNode(this.refs.fileName).value;
        data.savePath = ReactDOM.findDOMNode(this.refs.savePath).value;
        data.width = Number(ReactDOM.findDOMNode(this.refs.width).value) || 0;
        data.height = Number(ReactDOM.findDOMNode(this.refs.height).value) || 0;
        data.fixedSize = ReactDOM.findDOMNode(this.refs.fixedSize).checked;
        data.powerOfTwo = ReactDOM.findDOMNode(this.refs.powerOfTwo).checked;
        data.spritePadding = Number(ReactDOM.findDOMNode(this.refs.spritePadding).value) || 0;
        data.borderPadding = Number(ReactDOM.findDOMNode(this.refs.borderPadding).value) || 0;
        data.allowRotation = ReactDOM.findDOMNode(this.refs.allowRotation).checked;
        data.allowTrim = ReactDOM.findDOMNode(this.refs.allowTrim).checked;
        data.solverMode = ReactDOM.findDOMNode(this.refs.solverMode).value;
        data.disableMaxLimit = ReactDOM.findDOMNode(this.refs.disableMaxLimit).checked;
        data.packingAlgorithm = ReactDOM.findDOMNode(this.refs.packingAlgorithm).value;
        data.trimMode = ReactDOM.findDOMNode(this.refs.trimMode).value;
        data.alphaThreshold = ReactDOM.findDOMNode(this.refs.alphaThreshold).value;
        data.detectIdentical = ReactDOM.findDOMNode(this.refs.detectIdentical).checked;
        data.packer = ReactDOM.findDOMNode(this.refs.packer).value;
        data.packerMethod = ReactDOM.findDOMNode(this.refs.packerMethod).value;
        data.sortExportedRows = ReactDOM.findDOMNode(this.refs.sortExportedRows).value;

        this.packOptions = this.applyOptionsDefaults(data);
    }

    refreshPackOptions() {
        ReactDOM.findDOMNode(this.refs.textureName).value = this.packOptions.textureName;
        ReactDOM.findDOMNode(this.refs.textureFormat).value = this.packOptions.textureFormat;
        if (this.refs.compressPng) ReactDOM.findDOMNode(this.refs.compressPng).checked = this.packOptions.compressPng;
        if (this.refs.compressPngQuality) ReactDOM.findDOMNode(this.refs.compressPngQuality).value = this.packOptions.compressPngQuality;
        if (this.refs.compressPngStripMeta) ReactDOM.findDOMNode(this.refs.compressPngStripMeta).checked = this.packOptions.compressPngStripMeta;
        ReactDOM.findDOMNode(this.refs.removeFileExtension).checked = this.packOptions.removeFileExtension;
        ReactDOM.findDOMNode(this.refs.prependFolderName).checked = this.packOptions.prependFolderName;
        ReactDOM.findDOMNode(this.refs.base64Export).checked = this.packOptions.base64Export;
        //ReactDOM.findDOMNode(this.refs.tinify).checked = this.packOptions.tinify;
        //ReactDOM.findDOMNode(this.refs.tinifyKey).value = this.packOptions.tinifyKey;
        ReactDOM.findDOMNode(this.refs.scale).value = Number(this.packOptions.scale);
        ReactDOM.findDOMNode(this.refs.filter).value = this.packOptions.filter;
        ReactDOM.findDOMNode(this.refs.exporter).value = this.packOptions.exporter;
        ReactDOM.findDOMNode(this.refs.fileName).value = this.packOptions.fileName;
        ReactDOM.findDOMNode(this.refs.savePath).value = this.packOptions.savePath;
        ReactDOM.findDOMNode(this.refs.width).value = Number(this.packOptions.width) || 0;
        ReactDOM.findDOMNode(this.refs.height).value = Number(this.packOptions.height) || 0;
        ReactDOM.findDOMNode(this.refs.fixedSize).checked = this.packOptions.fixedSize;
        ReactDOM.findDOMNode(this.refs.powerOfTwo).checked = this.packOptions.powerOfTwo;
        ReactDOM.findDOMNode(this.refs.spritePadding).value = Number(this.packOptions.spritePadding) || 0;
        ReactDOM.findDOMNode(this.refs.borderPadding).value = Number(this.packOptions.borderPadding) || 0;
        ReactDOM.findDOMNode(this.refs.allowRotation).checked = this.packOptions.allowRotation;
        ReactDOM.findDOMNode(this.refs.allowTrim).checked = this.packOptions.allowTrim;
        ReactDOM.findDOMNode(this.refs.solverMode).value = this.packOptions.solverMode || 'manual';
        ReactDOM.findDOMNode(this.refs.disableMaxLimit).checked = this.packOptions.disableMaxLimit;
        ReactDOM.findDOMNode(this.refs.packingAlgorithm).value = this.packOptions.packingAlgorithm || 'best';
        ReactDOM.findDOMNode(this.refs.trimMode).value = this.packOptions.trimMode;
        ReactDOM.findDOMNode(this.refs.alphaThreshold).value = this.packOptions.alphaThreshold || 0;
        ReactDOM.findDOMNode(this.refs.detectIdentical).checked = this.packOptions.detectIdentical;
        ReactDOM.findDOMNode(this.refs.packer).value = this.packOptions.packer;
        ReactDOM.findDOMNode(this.refs.packerMethod).value = this.packOptions.packerMethod;
        ReactDOM.findDOMNode(this.refs.sortExportedRows).value = this.packOptions.sortExportedRows;
    }

    getPackOptions() {
        let data = Object.assign({}, this.packOptions);
        data.exporter = getExporterByType(data.exporter);
        data.packer = getPackerByType(data.packer);
        return data;
    }

    emitChanges() {
        Observer.emit(GLOBAL_EVENT.PACK_OPTIONS_CHANGED, this.getPackOptions());
    }

    onPackerChange(e) {
        this.setState({packer: e.target.value});
        this.onPropChanged();
    }

    onPropChanged() {
        this.updatePackOptions();
        this.saveOptions();

        this.emitChanges();
    }

    onExporterChanged() {
        let exporter = getExporterByType(ReactDOM.findDOMNode(this.refs.exporter).value);
        let allowTrimInput = ReactDOM.findDOMNode(this.refs.allowTrim);
        let allowRotationInput = ReactDOM.findDOMNode(this.refs.allowRotation);

        let doRefresh = (allowTrimInput.checked !== exporter.allowTrim) ||
                        (allowRotationInput.checked !== exporter.allowRotation);

        allowTrimInput.checked = exporter.allowTrim;
        allowRotationInput.checked = exporter.allowRotation;

        this.updateEditCustomTemplateButton();

        this.onExporterPropChanged();
        if(doRefresh) this.onPropChanged();
    }

    updateEditCustomTemplateButton() {
        let exporter = getExporterByType(ReactDOM.findDOMNode(this.refs.exporter).value);
        ReactDOM.findDOMNode(this.refs.editCustomFormat).style.visibility = exporter.type === "custom" ? "visible" : "hidden";
    }

    onExporterPropChanged() {
        this.updatePackOptions();
        this.saveOptions();
        this.forceUpdate();

        Observer.emit(GLOBAL_EVENT.PACK_EXPORTER_CHANGED, this.getPackOptions());
    }

    // Named this.forceUpdate() previously, which shadowed React.Component's
    // real inherited forceUpdate() method with this Enter-key handler -
    // every genuine this.forceUpdate() call elsewhere in this class (e.g.
    // onExporterPropChanged(), after switching texture format) silently did
    // nothing instead of re-rendering, since it always ran with no event
    // argument. Whether a change appeared to "work" depended entirely on
    // whether some unrelated re-render happened to also be in flight around
    // the same time - e.g. switching to ASTC showed its config rows only by
    // coincidence, and switching back to PNG left the ASTC-only view stuck
    // on screen with the PNG compression row never reappearing.
    onEnterKeyCommit(e) {
        if(e) {
            let key = e.keyCode || e.which;
            if (key === 13) this.onPropChanged();
        }
    }

    startExport() {
        Observer.emit(GLOBAL_EVENT.START_EXPORT);
    }

    editCustomExporter() {
        Observer.emit(GLOBAL_EVENT.SHOW_EDIT_CUSTOM_EXPORTER);
    }

    selectSavePath() {
        let dir = FileSystem.selectFolder();
        if(dir) {
            ReactDOM.findDOMNode(this.refs.savePath).value = dir;
            this.onExporterPropChanged();
        }
    }

    clearSparrowOrder() {
        sparrowStore.clearOrder();
    }

    render() {

        let exporter = getExporterByType(this.packOptions.exporter);
        let allowRotation = this.packOptions.allowRotation && exporter.allowRotation;
        let exporterRotationDisabled = exporter.allowRotation ? "" : "disabled";
        let allowTrim = this.packOptions.allowTrim && exporter.allowTrim;
        let exporterTrimDisabled = exporter.allowTrim ? "" : "disabled";
        let hasOrder = sparrowStore.hasOrder();

        return (
            <div className="props-list panel-surface">
                {/* Smart Size Preview - Real-time solver feedback */}
                <SmartSizePreview />
                
                <div className="pack-properties-containter">
                    <table>
                        <tbody>
                            <tr title={I18.f("TEXTURE_NAME_TITLE")}>
                                <td>{I18.f("TEXTURE_NAME")}</td>
                                <td><input ref="textureName" type="text" className="border-color-gray" defaultValue={this.packOptions.textureName} onBlur={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("TEXTURE_FORMAT_TITLE")}>
                                <td>{I18.f("TEXTURE_FORMAT")}</td>
                                <td>
                                    <select ref="textureFormat" className="border-color-gray" defaultValue={this.packOptions.textureFormat} onChange={this.onExporterChanged}>
                                        <option value="png">png</option>
                                        <option value="jpg">jpg</option>
                                        <option value="astc">ASTC (Android)</option>
                                    </select>
                                </td>
                                <td></td>
                            </tr>
                            {/* ASTC Configuration Options - Show only when ASTC is selected */}
                            <tr ref="astcConfig" style={{ display: this.packOptions.textureFormat === 'astc' ? '' : 'none' }}>
                                <td>ASTC Block:</td>
                                <td>
                                    <select ref="astcBlockSize" className="border-color-gray" defaultValue={this.packOptions.astcBlockSize || '4x4'} onChange={this.onExporterPropChanged}>
                                        <option value="4x4">4×4 (Mejor calidad)</option>
                                        <option value="5x5">5×5</option>
                                        <option value="6x6">6×6</option>
                                        <option value="8x8">8×8 (Mejor compresión)</option>
                                    </select>
                                </td>
                                <td></td>
                            </tr>
                            <tr ref="astcQualityConfig" style={{ display: this.packOptions.textureFormat === 'astc' ? '' : 'none' }}>
                                <td>ASTC Calidad:</td>
                                <td>
                                    <select ref="astcQuality" className="border-color-gray" defaultValue={this.packOptions.astcQuality || 'medium'} onChange={this.onExporterPropChanged}>
                                        <option value="fast">Rápida</option>
                                        <option value="medium">Media</option>
                                        <option value="thorough">Detallada</option>
                                        <option value="exhaustive">Exhaustiva</option>
                                    </select>
                                </td>
                                <td></td>
                            </tr>
                            {/* PNG Compression Options - Show only when PNG is selected */}
                            <tr ref="pngCompressConfig" style={{ display: this.packOptions.textureFormat === 'png' ? '' : 'none' }}>
                                <td>Comprimir PNG:</td>
                                <td><input ref="compressPng" className="border-color-gray" type="checkbox" defaultChecked={this.packOptions.compressPng ? "checked" : ""} onChange={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr>
                            <tr ref="pngCompressQualityRow" style={{ display: (this.packOptions.textureFormat === 'png' && this.packOptions.compressPng) ? '' : 'none' }}>
                                <td>  Calidad:</td>
                                <td>
                                    <input ref="compressPngQuality" type="number" min="0" max="1" step="0.1" className="border-color-gray" defaultValue={this.packOptions.compressPngQuality} onBlur={this.onExporterPropChanged} />
                                </td>
                                <td></td>
                            </tr>
                            <tr ref="pngCompressStripMetaRow" style={{ display: (this.packOptions.textureFormat === 'png' && this.packOptions.compressPng) ? '' : 'none' }}>
                                <td>  Strip meta:</td>
                                <td><input ref="compressPngStripMeta" className="border-color-gray" type="checkbox" defaultChecked={this.packOptions.compressPngStripMeta ? "checked" : ""} onChange={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("REMOVE_FILE_EXT_TITLE")}>
                                <td>{I18.f("REMOVE_FILE_EXT")}</td>
                                <td><input ref="removeFileExtension" className="border-color-gray" type="checkbox" defaultChecked={this.packOptions.removeFileExtension ? "checked" : ""} onChange={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("PREPEND_FOLDER_TITLE")}>
                                <td>{I18.f("PREPEND_FOLDER")}</td>
                                <td><input ref="prependFolderName" className="border-color-gray" type="checkbox" defaultChecked={this.packOptions.prependFolderName ? "checked" : ""} onChange={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("BASE64_EXPORT_TITLE")}>
                                <td>{I18.f("BASE64_EXPORT")}</td>
                                <td><input ref="base64Export" className="border-color-gray" type="checkbox" defaultChecked={this.packOptions.base64Export ? "checked" : ""} onChange={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr>
                            {/* <tr title={I18.f("TINIFY_TITLE")}>
                                <td>{I18.f("TINIFY")}</td>
                                <td><input ref="tinify" className="border-color-gray" type="checkbox" defaultChecked={this.packOptions.tinify ? "checked" : ""} onChange={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr> */}
                            {/* <tr title={I18.f("TINIFY_KEY_TITLE")}>
                                <td>{I18.f("TINIFY_KEY")}</td>
                                <td><input ref="tinifyKey" type="text" className="border-color-gray" defaultValue={this.packOptions.tinifyKey} onBlur={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr> */}
                            <tr title={I18.f("SCALE_TITLE")}>
                                <td>{I18.f("SCALE")}</td>
                                <td><input ref="scale" type="number" min="0" className="border-color-gray" defaultValue={this.packOptions.scale} onBlur={this.onPropChanged}/></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("FILTER_TITLE")}>
                                <td>{I18.f("FILTER")}</td>
                                <td>
                                    <select ref="filter" className="border-color-gray" onChange={this.onExporterChanged} defaultValue={this.packOptions.filter}>
                                        {filters.map(node => {
                                            return (<option key={"filter-" + node.type} defaultValue={node.type}>{node.type}</option>)
                                        })}
                                    </select>
                                </td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("FORMAT_TITLE")}>
                                <td>{I18.f("FORMAT")}</td>
                                <td>
                                    <select ref="exporter" className="border-color-gray" onChange={this.onExporterChanged} defaultValue={this.packOptions.exporter}>
                                    {exporters.map(node => {
                                        return (<option key={"exporter-" + node.type} defaultValue={node.type}>{node.type}</option>)
                                    })}
                                    </select>
                                </td>
                                <td>
                                    <div className="edit-btn back-800" ref="editCustomFormat" onClick={this.editCustomExporter}></div>
                                </td>
                            </tr>
                            
                            {/* BetterTA Info - Show only when BetterTA is selected */}
                            <tr ref="btaInfo" style={{ display: this.packOptions.exporter === 'BetterTA (Atlas)' ? '' : 'none', backgroundColor: '#2a4a6a' }}>
                                <td colSpan="3" style={{padding: '8px', color: '#a8d4ff', fontSize: '12px', textAlign: 'center'}}>
                                    <strong>BetterTA Atlas:</strong> Load <em>spritemap.json</em> + <em>Animation.json</em> in Sheet Splitter to preserve animation data
                                </td>
                            </tr>
                            <tr title={I18.f("FILE_NAME_TITLE")} style={{display: PLATFORM === 'web' ? '' : 'none'}}>
                                <td>{I18.f("FILE_NAME")}</td>
                                <td><input ref="fileName" className="border-color-gray" type="text" defaultValue={this.packOptions.fileName} onBlur={this.onExporterPropChanged} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("SAVE_PATH_TITLE")} style={{display: PLATFORM === 'electron' ? '' : 'none'}}>
                                <td>{I18.f("SAVE_PATH")}</td>
                                <td><input ref="savePath" className="border-color-gray" type="text" defaultValue={this.packOptions.savePath} onBlur={this.onExporterPropChanged} /></td>
                                <td>
                                    <div className="folder-btn back-800" onClick={this.selectSavePath}></div>
                                </td>
                            </tr>
                            <tr>
                                <td colSpan="3" className="center-align">
                                    <div className="btn back-800 border-color-gray color-white" onClick={this.startExport}>{I18.f("EXPORT")}</div>
                                </td>
                            </tr>

                            <tr title="Smart Size Solver Mode" style={{backgroundColor: '#2a2a3a'}}>
                                <td colSpan="3" className="center-align" style={{padding: '8px 0'}}>
                                    <strong>Washos Packer Smart Size</strong>
                                </td>
                            </tr>
                            <tr title="Solver Mode">
                                <td>Mode</td>
                                <td>
                                    <select ref="solverMode" className="border-color-gray" onChange={this.onPropChanged} defaultValue={this.packOptions.solverMode || 'manual'} style={{width: '100%'}}>
                                        <option value="manual">Manual (Fixed Size)</option>
                                        <option value="scale">Scale (Auto-fit & Scale)</option>
                                        <option value="auto">Auto (Smart Decision)</option>
                                        <option value="multi-atlas">Multi-Atlas</option>
                                    </select>
                                </td>
                                <td></td>
                            </tr>
                            <tr title="Packing Algorithm" style={{display: this.packOptions.solverMode !== 'manual' ? '' : 'none'}}>
                                <td>Algorithm</td>
                                <td>
                                    <select ref="packingAlgorithm" className="border-color-gray" onChange={this.onPropChanged} defaultValue={this.packOptions.packingAlgorithm || 'best'} style={{width: '100%'}}>
                                        <option value="best">Best Overall (Recommended)</option>
                                        <option value="maxrects_bssf">MaxRects (Best Short Side)</option>
                                        <option value="maxrects_blsf">MaxRects (Best Long Side)</option>
                                        <option value="maxrects_baf">MaxRects (Best Area Fit)</option>
                                        <option value="maxrects_blr">MaxRects (Bottom Left)</option>
                                        <option value="maxrects_cp">MaxRects (Contact Point)</option>
                                        <option value="guillotine_bssf">Guillotine (Short Side)</option>
                                        <option value="guillotine_baf">Guillotine (Best Area)</option>
                                        <option value="shelf">Shelf</option>
                                        <option value="skyline">Skyline</option>
                                    </select>
                                </td>
                                <td></td>
                            </tr>
                            <tr title="Disable 4096 size limit" style={{display: this.packOptions.solverMode !== 'manual' ? '' : 'none'}}>
                                <td>Disable 4096 Limit</td>
                                <td><input ref="disableMaxLimit" type="checkbox" className="border-color-gray" onChange={this.onPropChanged} defaultChecked={this.packOptions.disableMaxLimit ? "checked" : ""} /></td>
                                <td></td>
                            </tr>

                            <tr title={I18.f("WIDTH_TITLE")}>
                                <td>{I18.f("WIDTH")}</td>
                                <td><input ref="width" type="number" min="0" className="border-color-gray" defaultValue={this.packOptions.width} onBlur={this.onPropChanged} onKeyDown={this.onEnterKeyCommit}/></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("HEIGHT_TITLE")}>
                                <td>{I18.f("HEIGHT")}</td>
                                <td><input ref="height" type="number" min="0" className="border-color-gray" defaultValue={this.packOptions.height} onBlur={this.onPropChanged} onKeyDown={this.onEnterKeyCommit}/></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("PADDING_TITLE")}>
                                <td>{I18.f("PADDING")}</td>
                                <td><input ref="spritePadding" type="number" className="border-color-gray" defaultValue={this.packOptions.spritePadding} min="0" onInput={this.onPropChanged} onKeyDown={this.onEnterKeyCommit}/></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("EXTRUDE_TITLE")}>
                                <td>{I18.f("EXTRUDE")}</td>
                                <td><input ref="borderPadding" type="number" className="border-color-gray" defaultValue={this.packOptions.borderPadding} min="0" onInput={this.onPropChanged} onKeyDown={this.onEnterKeyCommit}/></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("ALLOW_ROTATION_TITLE")}>
                                <td>{I18.f("ALLOW_ROTATION")}</td>
                                <td><input ref="allowRotation" type="checkbox" className="border-color-gray" onChange={this.onPropChanged} defaultChecked={allowRotation ? "checked" : ""} disabled={exporterRotationDisabled} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("ALLOW_TRIM_TITLE")}>
                                <td>{I18.f("ALLOW_TRIM")}</td>
                                <td><input ref="allowTrim" type="checkbox" className="border-color-gray" onChange={this.onPropChanged} defaultChecked={allowTrim ? "checked" : ""}  disabled={exporterTrimDisabled} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("DETECT_IDENTICAL_TITLE")}>
                                <td>{I18.f("DETECT_IDENTICAL")}</td>
                                <td><input ref="detectIdentical" type="checkbox" className="border-color-gray" onChange={this.onPropChanged} defaultChecked={this.packOptions.detectIdentical ? "checked" : ""}/></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("PACKER_TITLE")}>
                                <td>{I18.f("PACKER")}</td>
                                <td>
                                    <select ref="packer" className="border-color-gray" onChange={this.onPackerChange} defaultValue={this.packOptions.packer}>
                                    {packers.map(node => {
                                        return (<option key={"packer-" + node.type} defaultValue={node.type}>{node.type}</option>)
                                    })}
                                    </select>
                                </td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("PACKER_METHOD_TITLE")}>
                                <td>{I18.f("PACKER_METHOD")}</td>
                                <td><PackerMethods ref="packerMethod" packer={this.state.packer} defaultMethod={this.packOptions.packerMethod} handler={this.onPropChanged}/></td>
                                <td></td>
                            </tr>
                            <tr>
                                <td colSpan="3" className="center-align">
                                    Advanced
                                </td>
                            </tr>

                            <tr title={I18.f("CLEAR_STORED_ORDER_TITLE")}>
                                <td colSpan="3" className="center-align">
                                    <div className={"btn "+ (hasOrder ? "back-800" : "back-400") +" border-color-gray color-white"} onClick={this.clearSparrowOrder}>{I18.f("CLEAR_STORED_ORDER")}</div>
                                </td>
                            </tr>

                            <tr title={I18.f("SORT_EXPORT_TITLE")}>
                                <td>{I18.f("SORT_EXPORT")}</td>
                                <td><input ref="sortExportedRows" type="checkbox" className="border-color-gray" onChange={this.onPropChanged} defaultChecked={this.packOptions.sortExportedRows ? "checked" : ""} /></td>
                                <td></td>
                            </tr>

                            <tr title={I18.f("FIXED_SIZE_TITLE")}>
                                <td>{I18.f("FIXED_SIZE")}</td>
                                <td><input ref="fixedSize" type="checkbox" className="border-color-gray" onChange={this.onPropChanged} defaultChecked={this.packOptions.fixedSize ? "checked" : ""} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("POWER_OF_TWO_TITLE")}>
                                <td>{I18.f("POWER_OF_TWO")}</td>
                                <td><input ref="powerOfTwo" type="checkbox" className="border-color-gray" onChange={this.onPropChanged} defaultChecked={this.packOptions.powerOfTwo ? "checked" : ""} /></td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("TRIM_MODE_TITLE")}>
                                <td>{I18.f("TRIM_MODE")}</td>
                                <td>
                                    <select ref="trimMode" className="border-color-gray" onChange={this.onPropChanged} defaultValue={this.packOptions.trimMode}  disabled={exporterTrimDisabled || !this.packOptions.allowTrim}>
                                        <option value="trim">trim</option>
                                        <option value="crop">crop</option>
                                    </select>
                                </td>
                                <td></td>
                            </tr>
                            <tr title={I18.f("ALPHA_THRESHOLD_TITLE")}>
                                <td>{I18.f("ALPHA_THRESHOLD")}</td>
                                <td><input ref="alphaThreshold" type="number" className="border-color-gray" defaultValue={this.packOptions.alphaThreshold} min="0" max="255" onBlur={this.onPropChanged} onKeyDown={this.onEnterKeyCommit}/></td>
                                <td></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
}

class PackerMethods extends React.Component {
    render() {
        let packer = getPackerByType(this.props.packer);

        if(!packer) {
            throw new Error("Unknown packer " + this.props.packer);
        }

        let items = [];

        let methods = Object.keys(packer.methods);
        for(let item of methods) {
            items.push(<option value={item} key={"packer-method-" + item }>{item}</option>);
        }

        return (
            <select onChange={this.props.handler} className="border-color-gray" defaultValue={this.props.defaultMethod} >{items}</select>
        )
    }
}

export default PackProperties;
