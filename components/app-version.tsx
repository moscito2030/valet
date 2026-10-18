export function AppVersion() {
  const sha = process.env.NEXT_PUBLIC_APP_COMMIT;
  const message = process.env.NEXT_PUBLIC_APP_COMMIT_MESSAGE;
  return sha ? (
    <a className="app-version" href={`https://github.com/moscito2030/valet/commit/${sha}`} target="_blank" rel="noopener noreferrer"
      title={`${sha}${message ? ` · ${message}` : ''}`} aria-label={`目前版本 ${sha}，查看 commit 詳情`}>
      Valet · {sha.slice(0, 7)}
    </a>
  ) : <span className="app-version">Valet · {process.env.NEXT_PUBLIC_APP_DEPLOYED === '1' ? '版本資訊未提供' : '本機開發版'}</span>;
}
