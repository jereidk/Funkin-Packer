import React from 'react';

import {Observer, GLOBAL_EVENT} from '../Observer';
import I18 from '../utils/I18';
import appInfo from '../../../package.json';
import languages from '../resources/static/localization/languages.json';
import AtlasStatsHeader from './AtlasStatsHeader.jsx';
import VersionInfo from './VersionInfo.jsx';

class MainHeader extends React.Component {
    constructor(props) {
        super(props);

        this.changeLanguage = this.changeLanguage.bind(this);
        this.toggleTheme = this.toggleTheme.bind(this);
        
        // Load theme from localStorage or default to dark
        const savedTheme = localStorage.getItem('funkypacker-theme') || 'dark';
        this.state = {
            theme: savedTheme
        };
    }

    componentDidMount() {
        // Apply theme on mount
        document.documentElement.setAttribute('data-theme', this.state.theme);
    }

    /* showAbout() {
        Observer.emit(GLOBAL_EVENT.SHOW_ABOUT);
    } */

    changeLanguage(e) {
        Observer.emit(GLOBAL_EVENT.CHANGE_LANG, e.target.value);
    }

    toggleTheme() {
        const newTheme = this.state.theme === 'dark' ? 'light' : 'dark';
        this.setState({ theme: newTheme });
        localStorage.setItem('funkypacker-theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    }

    showSplitter() {
        Observer.emit(GLOBAL_EVENT.SHOW_SHEET_SPLITTER);
    }

    render() {
        return (
            <div className="main-header back-900 color-white">
                <div className="main-header-app-name">
                    <img src="static/images/logo.png" alt="Logo" />
                    {appInfo.displayName} {appInfo.version}
                    <div className='based-on'>Based on Free Texture Packer</div>
                </div>

                {/* <div className="main-header-about" onClick={this.showAbout}>
                    ?
                </div> */}

                <div className='main-header-info'>
                    <AtlasStatsHeader />
                </div>

                <div className='main-header-github'>
                    <a href="https://github.com/NeeEoo/funkin-tex-packer">
                        <img src="static/images/github-mark-white.png" height="25" alt="Github" />
                    </a>
                </div>

                <div className="main-header-theme" onClick={this.toggleTheme} title="Toggle Dark/Light Mode">
                    {this.state.theme === 'dark' ? '☀️' : '🌙'}
                </div>

                <div className="main-header-language border-color-gray">
                    {I18.f("LANGUAGE")}
                    <select defaultValue={I18.currentLocale} onChange={this.changeLanguage}>
                        {
                            languages.map((item) => {
                                return (
                                    <option key={"localization_" + item.lang} value={item.lang}>
                                        {item.name}
                                    </option>
                                )
                            })
                        }
                    </select>
                </div>

                <div className="main-header-controls">
                    <div className="btn back-700 border-color-gray color-white" onClick={this.showSplitter}>{I18.f("SPLITTER")}</div>
                </div>
                
                {/* Version info badge - click for commit history */}
                <VersionInfo />
            </div>
        );
    }
}

export default MainHeader;