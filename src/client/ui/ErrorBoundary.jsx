import React from 'react';

/**
 * ErrorBoundary - keeps a render/lifecycle crash visible.
 *
 * React 16 unmounts the ENTIRE component tree when an error escapes render or a
 * lifecycle method and no boundary catches it. The result is a bare page showing
 * only the body background (#1a1a2e - the "blue screen"), with LogConsole gone
 * too, so the error that caused it is unreadable.
 *
 * This catches the error, reports it through console.error (so LogConsole picks
 * it up if that part of the tree survived) and renders the message and stack with
 * a copy button.
 */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);

        this.state = { error: null, info: null, copied: false };

        this.reload = this.reload.bind(this);
        this.dismiss = this.dismiss.bind(this);
        this.copy = this.copy.bind(this);
    }

    static getDerivedStateFromError(error) {
        return { error: error };
    }

    componentDidCatch(error, info) {
        this.setState({ info: info });

        // Routed through console.error on purpose: LogConsole intercepts it, and
        // it lands in the browser console with a real stack for anyone with
        // devtools open.
        console.error(
            `[ErrorBoundary] ${this.props.name || 'App'} crashed:`,
            error && error.message ? error.message : String(error),
            error && error.stack ? '\n' + error.stack : '',
            info && info.componentStack ? '\nComponent stack:' + info.componentStack : ''
        );
    }

    report() {
        const { error, info } = this.state;

        return [
            `${this.props.name || 'App'} crashed`,
            error && error.message ? error.message : String(error),
            error && error.stack ? error.stack : '',
            info && info.componentStack ? 'Component stack:' + info.componentStack : ''
        ].filter(Boolean).join('\n\n');
    }

    copy() {
        const text = this.report();

        const done = () => {
            this.setState({ copied: true });
            setTimeout(() => this.setState({ copied: false }), 1500);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, done);
        } else {
            done();
        }
    }

    dismiss() {
        this.setState({ error: null, info: null });
    }

    reload() {
        window.location.reload();
    }

    render() {
        const { error, info, copied } = this.state;

        if (!error) return this.props.children;

        return (
            <div style={styles.wrap}>
                <div style={styles.panel}>
                    <div style={styles.title}>
                        {this.props.name || 'La aplicación'} ha fallado
                    </div>

                    <div style={styles.message}>
                        {error && error.message ? error.message : String(error)}
                    </div>

                    <pre style={styles.stack}>
                        {(error && error.stack ? error.stack : '')}
                        {info && info.componentStack ? '\n\nComponent stack:' + info.componentStack : ''}
                    </pre>

                    <div style={styles.buttons}>
                        <button style={styles.btn} onClick={this.copy}>
                            {copied ? '¡Copiado!' : 'Copiar error'}
                        </button>
                        <button style={styles.btn} onClick={this.dismiss}>
                            Intentar continuar
                        </button>
                        <button style={styles.btn} onClick={this.reload}>
                            Recargar
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

const styles = {
    wrap: {
        position: 'fixed',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        padding: '20px',
        boxSizing: 'border-box'
    },
    panel: {
        backgroundColor: '#1a1a2e',
        border: '1px solid #ff6b6b',
        borderRadius: '8px',
        maxWidth: '860px',
        width: '100%',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        boxSizing: 'border-box',
        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
        textAlign: 'left'
    },
    title: {
        color: '#ff6b6b',
        fontSize: '16px',
        fontWeight: 'bold',
        marginBottom: '10px'
    },
    message: {
        color: '#fff',
        fontSize: '13px',
        marginBottom: '12px',
        wordBreak: 'break-word'
    },
    stack: {
        color: '#aaa',
        fontSize: '11px',
        overflow: 'auto',
        flex: 1,
        minHeight: '80px',
        maxHeight: '50vh',
        margin: 0,
        padding: '10px',
        backgroundColor: '#12121f',
        borderRadius: '4px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        userSelect: 'text'
    },
    buttons: {
        display: 'flex',
        gap: '10px',
        marginTop: '14px'
    },
    btn: {
        padding: '6px 14px',
        backgroundColor: '#444',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '12px'
    }
};

export default ErrorBoundary;
