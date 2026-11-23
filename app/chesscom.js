// Import finished games from chess.com's public Published-Data API.
// https://www.chess.com/news/view/published-data-api — only completed games are exposed.

const API = 'https://api.chess.com/pub/player/';

async function getJson(url) {
  const r = await fetch(url);
  if (r.status === 404) throw new Error('user not found');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchRecentGames(username, limit = 15) {
  const user = encodeURIComponent(username.toLowerCase());
  const { archives = [] } = await getJson(`${API}${user}/games/archives`);
  const games = [];
  for (let i = archives.length - 1; i >= 0 && games.length < limit; i--) {
    const month = await getJson(archives[i]);
    const list = (month.games || []).filter((g) => g.pgn && (g.rules || 'chess') === 'chess').reverse();
    games.push(...list);
  }
  return games.slice(0, limit).map((g) => {
    const me = g.white.username.toLowerCase() === username.toLowerCase() ? 'white' : 'black';
    const opp = me === 'white' ? g.black : g.white;
    const res = g[me].result;
    const outcome = res === 'win' ? 'Won' : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(res) ? 'Draw' : 'Lost';
    const date = new Date(g.end_time * 1000).toLocaleDateString();
    return {
      pgn: g.pgn,
      url: g.url,
      label: `${outcome} vs ${opp.username} (${opp.rating}) · ${g.time_class}${g.rated ? '' : ' · unrated'} · ${date}`,
    };
  });
}
