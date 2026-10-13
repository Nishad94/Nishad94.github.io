// Invented metadata only: never copied from a Spotify account.
export function syntheticSpotifySample(count = 5) {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new RangeError('Choose 1-50 synthetic items.');
  const artists = Array.from({ length: count }, (_, index) => ({
    id: 'syntheticArtist' + String(index + 1).padStart(2, '0'),
    name: 'Synthetic Observatory Artist ' + String(index + 1).padStart(2, '0'),
    genres: index % 2 ? ['synthetic dream-pop', 'synthetic electronic'] : []
  }));
  const tracks = artists.map((artist, index) => ({
    id: 'syntheticTrack' + String(index + 1).padStart(2, '0'),
    name: 'Synthetic Night Signal ' + String(index + 1).padStart(2, '0'),
    artists: [artist],
    explicit: false
  }));
  return { artists, tracks };
}
