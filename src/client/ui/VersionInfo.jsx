import React from 'react';
import appInfo from '../../../package.json';

// Version info - updated manually with each release
// This displays the latest commits in a tooltip
const VERSION_INFO = {
    // Static values - update these when deploying
    commit: 'c21889d',
    branch: 'main',
    date: '2026-06-20',
    commits: [
        { hash: 'c21889d', message: 'Enhanced debug logging for JSZip charCodeAt error', date: '2026-06-20' },
        { hash: '814f039', message: 'Fix syntax error in debug logs', date: '2026-06-20' },
        { hash: '8dc5908', message: 'Add debug logging to trace JSZip error source', date: '2026-06-20' },
        { hash: '407a7a7', message: 'Add debug logging to Downloader for JSZip errors', date: '2026-06-20' },
        { hash: '9f3d04b', message: 'Fix JSZip error in doRepack by stripping data URL prefix', date: '2026-06-20' },
    ]
};

class VersionInfo extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            showTooltip: false,
            isStale: false
        };
        this.toggleTooltip = this.toggleTooltip.bind(this);
        this.hideTooltip = this.hideTooltip.bind(this);
    }

    componentDidMount() {
        // Check if version is stale (older than 1 hour)
        const buildAge = Date.now() - new Date(VERSION_INFO.date).getTime();
        const oneHour = 60 * 60 * 1000;
        if (buildAge > oneHour) {
            this.setState({ isStale: true });
        }
    }

    toggleTooltip() {
        this.setState(prev => ({ showTooltip: !prev.showTooltip }));
    }

    hideTooltip() {
        this.setState({ showTooltip: false });
    }

    render() {
        const { showTooltip, isStale } = this.state;
        const shortCommit = VERSION_INFO.commit.substring(0, 7);
        
        return (
            <div className="version-info" style={{ position: 'relative', display: 'inline-block' }}>
                <button 
                    className={`version-badge ${isStale ? 'version-badge-stale' : ''}`}
                    onClick={this.toggleTooltip}
                    title="Click for version info"
                    style={{
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        fontSize: '10px',
                        color: isStale ? '#ff6b6b' : '#4ecdc4',
                        cursor: 'pointer',
                        marginLeft: '8px'
                    }}
                >
                    {isStale ? '⚠️' : '📦'} v{appInfo.version}
                </button>
                
                {showTooltip && (
                    <div 
                        className="version-tooltip"
                        onMouseLeave={this.hideTooltip}
                        style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: '8px',
                            background: 'var(--bg-secondary, #2d2d2d)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            padding: '12px',
                            minWidth: '350px',
                            maxWidth: '500px',
                            zIndex: 1000,
                            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                            textAlign: 'left',
                            fontSize: '12px',
                            color: 'var(--text-primary, #fff)'
                        }}
                    >
                        <div style={{ 
                            borderBottom: '1px solid rgba(255,255,255,0.1)', 
                            paddingBottom: '8px', 
                            marginBottom: '10px',
                            fontWeight: 'bold'
                        }}>
                            🏗️ Build Info
                        </div>
                        
                        <div style={{ marginBottom: '8px' }}>
                            <strong>Version:</strong> {appInfo.version}
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                            <strong>Commit:</strong> <code style={{ 
                                background: 'rgba(0,0,0,0.3)', 
                                padding: '2px 4px', 
                                borderRadius: '3px',
                                fontSize: '11px'
                            }}>{shortCommit}</code>
                        </div>
                        <div style={{ marginBottom: '12px' }}>
                            <strong>Build Date:</strong> {VERSION_INFO.date}
                        </div>
                        
                        <div style={{ 
                            borderTop: '1px solid rgba(255,255,255,0.1)', 
                            paddingTop: '10px',
                            marginTop: '10px'
                        }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                                📋 Last Commits:
                            </div>
                            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                {VERSION_INFO.commits.map((commit, index) => (
                                    <div key={index} style={{ 
                                        marginBottom: '8px',
                                        padding: '6px',
                                        background: 'rgba(0,0,0,0.2)',
                                        borderRadius: '4px'
                                    }}>
                                        <div style={{ 
                                            display: 'flex', 
                                            alignItems: 'center',
                                            gap: '6px',
                                            marginBottom: '4px'
                                        }}>
                                            <code style={{ 
                                                color: '#4ecdc4',
                                                fontSize: '10px'
                                            }}>{commit.hash}</code>
                                            <span style={{ 
                                                color: 'rgba(255,255,255,0.5)',
                                                fontSize: '10px'
                                            }}>{commit.date}</span>
                                        </div>
                                        <div style={{ 
                                            color: 'var(--text-secondary, #aaa)',
                                            fontSize: '11px',
                                            lineHeight: '1.3'
                                        }}>
                                            {commit.message}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        <div style={{ 
                            marginTop: '10px',
                            paddingTop: '10px',
                            borderTop: '1px solid rgba(255,255,255,0.1)',
                            fontSize: '10px',
                            color: 'rgba(255,255,255,0.5)',
                            textAlign: 'center'
                        }}>
                            💡 Refresh page (Ctrl+F5) to get latest version
                        </div>
                    </div>
                )}
            </div>
        );
    }
}

export default VersionInfo;
