import type { VideoSummary } from '../types';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** "[m:ss.s] text" lines; lines that start inside the first 3 seconds are highlighted as the hook. */
function Transcript({ text, source }: { text: string; source?: string }) {
  const lines = text.split('\n').map((line) => {
    const m = /^\[(\d+):(\d{1,2}(?:\.\d+)?)\]\s*(.*)$/.exec(line.trim());
    return m ? { time: `${m[1]}:${m[2]}`, sec: Number(m[1]) * 60 + Number(m[2]), words: m[3] } : { words: line };
  });
  return (
    <details className="transcript">
      <summary className="tiny">
        Transcript <span className="muted">· {source ?? 'unknown source'}</span>
      </summary>
      <div className="transcript-lines">
        {lines.map((l, i) => (
          <div key={i} className={'sec' in l && l.sec !== undefined && l.sec < 3 ? 'hook' : undefined}>
            {'time' in l && <span className="muted">{l.time}</span>} {l.words}
          </div>
        ))}
      </div>
    </details>
  );
}

export function VideoCard({ video, onDelete }: { video: VideoSummary; onDelete?: () => void }) {
  const stats = [
    ['▶', video.views],
    ['♥', video.likes],
    ['💬', video.comments],
    ['↗', video.shares],
  ].filter(([, n]) => typeof n === 'number') as [string, number][];

  return (
    <div className="video-card">
      {video.thumbnailUrl ? (
        <img src={video.thumbnailUrl} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      ) : (
        <div className="thumb-placeholder">🎬</div>
      )}
      <div className="video-info">
        <div className="video-title">
          <span className="pill">{video.platform ?? 'Video'}</span>
          {video.author && <strong>@{video.author.replace(/^@/, '')}</strong>}
          {video.durationSec !== undefined && <span className="muted">{video.durationSec.toFixed(0)}s</span>}
          {onDelete && (
            <button className="icon-button video-delete" onClick={onDelete} aria-label="Delete video" title="Delete video">
              🗑
            </button>
          )}
        </div>
        {video.caption && <p className="caption">{video.caption}</p>}
        {stats.length > 0 && (
          <div className="stats">
            {stats.map(([icon, n]) => (
              <span key={icon}>
                {icon} {compact.format(n)}
              </span>
            ))}
          </div>
        )}
        {video.transcript ? (
          <Transcript text={video.transcript} source={video.transcriptSource} />
        ) : (
          <div className="muted tiny">Transcript: {video.transcriptSource ?? 'none'}</div>
        )}
        {video.sourceUrl && (
          <a className="tiny" href={video.sourceUrl} target="_blank" rel="noreferrer">
            Open original ↗
          </a>
        )}
      </div>
    </div>
  );
}
