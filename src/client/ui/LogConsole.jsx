import React from 'react';

/**
 * LogConsole - Shows runtime logs and errors for debugging
 * 
 * Intercepts console.log, console.warn, console.error and displays them
 * in a collapsible panel in the UI.
 */
class LogConsole extends React.Component {
    constructor(props) {
        super(props);
        
        this.state = {
            isExpanded: false,
            logs: [],
            maxLogs: 100,
            filter: 'all', // 'all', 'error', 'warn'
            showTimestamps: true
        };
        
        // Bind methods
        this.togglePanel = this.togglePanel.bind(this);
        this.clearLogs = this.clearLogs.bind(this);
        this.copyLogs = this.copyLogs.bind(this);
        this.handleLog = this.handleLog.bind(this);
        
        // Save originals before overriding
        this.originalLog = console.log;
        this.originalWarn = console.warn;
        this.originalError = console.error;
        this.originalInfo = console.info;
        this.originalDebug = console.debug;

        this.attachConsoleListeners();
    }

    componentDidUpdate() {
        // Auto-scroll to latest log entry
        if (this.state.isExpanded && this.logList) {
            this.logList.scrollTop = this.logList.scrollHeight;
        }
    }

    componentWillUnmount() {
        console.log = this.originalLog;
        console.warn = this.originalWarn;
        console.error = this.originalError;
        console.info = this.originalInfo;
        console.debug = this.originalDebug;
    }

    attachConsoleListeners() {
        const capture = (type, original) => (...args) => {
            original.apply(console, args);
            this.handleLog(type, args);
        };

        console.log   = capture('log',   this.originalLog);
        console.warn  = capture('warn',  this.originalWarn);
        console.error = capture('error', this.originalError);
        console.info  = capture('log',   this.originalInfo);
        console.debug = capture('log',   this.originalDebug);

        window.onerror = (message, source, lineno, colno, error) => {
            this.handleLog('error', [`Uncaught: ${message} at ${source}:${lineno}:${colno}`, error?.stack]);
            return false;
        };

        window.onunhandledrejection = (event) => {
            this.handleLog('error', [`Unhandled promise rejection: ${event.reason}`]);
        };
    }

    handleLog(type, args) {
        const timestamp = new Date().toLocaleTimeString();
        const message = args.map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');

        this.setState(prev => {
            const logs = [...prev.logs, { type, message, timestamp }];
            // Keep only last maxLogs
            if (logs.length > prev.maxLogs) {
                logs.shift();
            }
            return { logs };
        });
    }

    togglePanel() {
        this.setState(prev => ({ isExpanded: !prev.isExpanded }));
    }

    clearLogs() {
        this.setState({ logs: [] });
    }

    copyLogs() {
        const { logs, showTimestamps } = this.state;
        const text = logs.map(log => {
            const timestamp = showTimestamps ? `[${log.timestamp}] ` : '';
            const type = `[${log.type.toUpperCase()}] `;
            return `${timestamp}${type}${log.message}`;
        }).join('\n');
        
        navigator.clipboard.writeText(text).then(() => {
            // Show brief "Copied!" feedback
            const btn = this.copyBtn;
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = '¡Copiado!';
                btn.style.backgroundColor = '#2ecc71';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.backgroundColor = '#444';
                }, 1500);
            }
        }).catch(err => {
            console.error('Failed to copy logs:', err);
        });
    }

    getLogIcon(type) {
        switch (type) {
            case 'error': return '❌';
            case 'warn': return '⚠️';
            default: return 'ℹ️';
        }
    }

    getLogStyle(type) {
        switch (type) {
            case 'error': return { color: '#ff6b6b', backgroundColor: 'rgba(255, 107, 107, 0.1)' };
            case 'warn': return { color: '#facc15', backgroundColor: 'rgba(250, 204, 21, 0.1)' };
            default: return { color: '#aaa' };
        }
    }

    render() {
        const { isExpanded, logs, filter, showTimestamps } = this.state;
        
        // Count errors and warnings
        const errorCount = logs.filter(l => l.type === 'error').length;
        const warnCount = logs.filter(l => l.type === 'warn').length;
        
        // Filter logs
        const filteredLogs = filter === 'all' 
            ? logs 
            : logs.filter(l => l.type === filter);

        return (
            <div style={styles.container}>
                {/* Header */}
                <div style={styles.header} onClick={this.togglePanel}>
                    <span style={styles.title}>
                        📋 Consola
                        {errorCount > 0 && (
                            <span style={styles.badgeError}>{errorCount}</span>
                        )}
                        {warnCount > 0 && (
                            <span style={styles.badgeWarn}>{warnCount}</span>
                        )}
                    </span>
                    <span style={styles.toggleIcon}>{isExpanded ? '▼' : '▲'}</span>
                </div>
                
                {/* Content */}
                {isExpanded && (
                    <div style={styles.content}>
                        {/* Toolbar */}
                        <div style={styles.toolbar}>
                            <select
                                value={filter}
                                onChange={(e) => this.setState({ filter: e.target.value })}
                                style={styles.filterSelect}
                            >
                                <option value="all">Todos ({logs.length})</option>
                                <option value="error">Errores ({errorCount})</option>
                                <option value="warn">Advertencias ({warnCount})</option>
                            </select>
                            <label style={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={showTimestamps}
                                    onChange={(e) => this.setState({ showTimestamps: e.target.checked })}
                                />
                                Hora
                            </label>
                            <button 
                                ref={el => this.copyBtn = el}
                                style={styles.clearBtn} 
                                onClick={this.copyLogs}
                            >
                                📋 Copiar
                            </button>
                            <button style={styles.clearBtn} onClick={this.clearLogs}>
                                Limpiar
                            </button>
                        </div>
                        
                        {/* Log List */}
                        <div style={styles.logList} ref={el => this.logList = el}>
                            {filteredLogs.length === 0 ? (
                                <div style={styles.emptyMessage}>
                                    Sin logs - carga un PNG en SheetSplitter para ver errores
                                </div>
                            ) : (
                                filteredLogs.map((log, i) => (
                                    <div 
                                        key={i} 
                                        style={{
                                            ...styles.logEntry,
                                            ...this.getLogStyle(log.type)
                                        }}
                                    >
                                        <span style={styles.logIcon}>{this.getLogIcon(log.type)}</span>
                                        {showTimestamps && (
                                            <span style={styles.timestamp}>{log.timestamp}</span>
                                        )}
                                        <pre style={styles.logMessage}>{log.message}</pre>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }
}

const styles = {
    container: {
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        width: '400px',
        maxHeight: '500px',
        backgroundColor: '#1a1a2e',
        borderRadius: '8px',
        border: '1px solid #333',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
        fontSize: '12px',
        fontFamily: 'Monaco, Menlo, "Courier New", monospace'
    },
    header: {
        padding: '10px 15px',
        backgroundColor: '#252540',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: '8px 8px 0 0'
    },
    title: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    },
    badgeError: {
        backgroundColor: '#ff6b6b',
        color: '#fff',
        padding: '2px 6px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 'bold'
    },
    badgeWarn: {
        backgroundColor: '#facc15',
        color: '#000',
        padding: '2px 6px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 'bold'
    },
    toggleIcon: {
        color: '#888',
        fontSize: '12px'
    },
    content: {
        maxHeight: '400px',
        display: 'flex',
        flexDirection: 'column'
    },
    toolbar: {
        padding: '8px',
        backgroundColor: '#252540',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        borderBottom: '1px solid #333'
    },
    filterSelect: {
        flex: 1,
        padding: '4px 8px',
        backgroundColor: '#333',
        color: '#fff',
        border: '1px solid #444',
        borderRadius: '4px',
        fontSize: '11px'
    },
    checkboxLabel: {
        color: '#888',
        fontSize: '11px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px'
    },
    clearBtn: {
        padding: '4px 10px',
        backgroundColor: '#444',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '11px'
    },
    logList: {
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
        maxHeight: '350px'
    },
    emptyMessage: {
        color: '#666',
        textAlign: 'center',
        padding: '20px',
        fontStyle: 'italic'
    },
    logEntry: {
        padding: '6px 8px',
        marginBottom: '4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px'
    },
    logIcon: {
        flexShrink: 0
    },
    timestamp: {
        color: '#666',
        fontSize: '10px',
        flexShrink: 0
    },
    logMessage: {
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontSize: '11px',
        fontFamily: 'inherit',
        flex: 1
    }
};

export default LogConsole;
