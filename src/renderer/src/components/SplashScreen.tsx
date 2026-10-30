export function SplashScreen({ leaving, ready }: { leaving: boolean; ready: boolean }) {
  const letters = ['风', '信']
  return (
    <div
      className={`splash ${leaving ? 'is-leaving' : ''} ${ready ? 'is-ready' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={ready ? '准备就绪' : '正在启动风信启动器'}
    >
      <span className="splash-foot splash-foot--left">WINDLETTER</span>
      <span className="splash-foot splash-foot--right">MINECRAFT JAVA EDITION</span>

      <div className="splash-center">
        <div className="splash-mark" aria-hidden="true">
          <svg viewBox="0 0 120 120" width="112" height="112">
            <circle className="splash-path splash-path--moon" cx="60" cy="60" r="38" />
            <path
              className="splash-path splash-path--wind"
              d="M16 78c16-8 28-5 41 1s25 5 44-4"
            />
            <path
              className="splash-path splash-path--wind-2"
              d="M29 96c12-5 22-4 34 1"
            />
            <circle className="splash-seal" cx="88" cy="28" r="2.4" />
          </svg>
        </div>

        <span className="splash-kicker">WINDLETTER / WORKSPACE</span>
        <h1 className="splash-wordmark" aria-label="风信启动器">
          {letters.map((letter, index) => (
            <span key={letter} style={{ animationDelay: `${0.28 + index * 0.08}s` }}>
              {letter}
            </span>
          ))}
        </h1>
        <span className="splash-sub">风有信 · 月无边</span>

        <div className="splash-progress" aria-hidden="true">
          <span className="splash-progress-fill" />
        </div>
        <span className="splash-status">
          {ready ? '准备就绪' : '正在读取本机配置与账户信息'}
        </span>
      </div>
    </div>
  )
}
