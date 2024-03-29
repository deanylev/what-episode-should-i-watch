import { randomBytes, randomInt } from 'crypto';
import { AddressInfo } from 'net';
import { promisify } from 'util';

import cors from 'cors';
import express from 'express';
import MovieDB from 'node-themoviedb';

const { NODE_ENV, PORT, TMDB_API_KEY } = process.env;

if (!TMDB_API_KEY) {
  console.error('Error: missing TMDB API key');
  process.exit(1);
}

const mdb = new MovieDB(TMDB_API_KEY);

const app = express();

if (NODE_ENV !== 'production') {
  app.use(cors());
}

app.get('/privacy', (req, res) => {
  res.sendFile(`${__dirname}/public/privacy.html`);
});

app.use(express.static('frontend/build'));

const generateId = async () => {
  const buffer = await promisify(randomBytes)(5);
  return buffer.toString('hex');
};

const constructImageUrl = (path: string) => `https://image.tmdb.org/t/p/original/${path}`;

const isValidShow = ({ posterUrl, yearStart }: { posterUrl: string | null; yearStart: string | null }) => !!(posterUrl && yearStart)

const serializeShow = ({ first_air_date, id, name, popularity, poster_path }: { first_air_date: string; id: number; name: string; popularity: number; poster_path: string | null; }) => ({
  id: id.toString(),
  popularity,
  posterUrl: poster_path && constructImageUrl(poster_path),
  title: name,
  yearStart: first_air_date && first_air_date.split('-')[0] || null
});

const serializeEpisode = ({ last_air_date, next_episode_to_air, number_of_seasons }: MovieDB.Responses.TV.GetDetails, { air_date, episode_number, name, overview, season_number, still_path, vote_average }: MovieDB.Responses.TV.Episode.GetDetails) => ({
  episode: episode_number,
  plot: overview,
  posterUrl: still_path && constructImageUrl(still_path),
  rating: vote_average.toFixed(1),
  season: season_number,
  showYearEnd: next_episode_to_air ? null : last_air_date.split('-')[0],
  title: name,
  totalSeasons: number_of_seasons,
  year: air_date.split('-')[0],
});

const showOverrides: Record<string, object> = {};
const episodeOverrides: Record<string, object> = {};
const getShowData = async (id: string) => {
  const { data } = await mdb.tv.getDetails({
    pathParameters: {
      tv_id: id
    }
  });
  return {
    ...data,
    ...showOverrides[id]
  };
};
const getEpisodeData = async (showId: string, season: number, episode: number) => {
  const { data } = await mdb.tv.episode.getDetails({
    pathParameters: {
      tv_id: showId,
      season_number: season,
      episode_number: episode
    }
  });
  return {
    ...data,
    ...episodeOverrides[showId]
  };
};

app.get('/shows', async (req, res) => {
  const { q } = req.query;
  const trimmedQuery = typeof q === 'string' ? q.trim().toLowerCase() : '';
  if (!trimmedQuery) {
    res.sendStatus(400);
    return;
  }

  const requestId = await generateId();
  console.log('querying shows', {
    requestId,
    trimmedQuery,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });

  try {
    const { data: { results } } = await mdb.search.TVShows({
      query: {
        query: trimmedQuery
      }
    });

    console.log('show results', {
      requestId,
      amount: results.length
    });

    const shows = results.map((show) => serializeShow({ ...show, ...showOverrides[show.id] })).filter((show) => isValidShow(show));
    shows.sort((a, b) => {
      // prioritise the greatest comedy of all time
      if (trimmedQuery === 'peep') {
        const peepShow = [a, b].find(({ id }) => id === '815');
        if (peepShow) {
          return peepShow === a ? -1 : 1;
        }
      }

      return b.popularity - a.popularity;
    });
    res.json(shows);
  } catch (error) {
    console.error('error while querying shows', {
      requestId,
      error
    });
    res.sendStatus(500);
  }
});

app.get('/shows/:id', async (req, res) => {
  const requestId = await generateId();

  try {
    const { id } = req.params;
    const data = await getShowData(id);
    const show = serializeShow(data);
    if (!isValidShow(show)) {
      res.sendStatus(404);
      return;
    }
    res.json(show);
  } catch (error) {
    if ((error as { errorCode: number; }).errorCode === 404) {
      res.sendStatus(404);
      return;
    }

    console.error('error while finding show', {
      requestId,
      error
    });
    res.sendStatus(500);
  }
});

app.get('/episodes/:showId', async (req, res) => {
  const { showId } = req.params;

  const requestId = await generateId();
  console.log('querying show', {
    requestId,
    id: showId,
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  });

  try {
    const showData = await getShowData(showId);
    const { number_of_seasons, seasons } = showData;

    const { history, seasonMax, seasonMin } = req.query;
    const parsedSeasonMin = typeof seasonMin === 'string' ? (parseInt(seasonMin, 10) || 1) : 1;
    const parsedSeasonMax = typeof seasonMax === 'string' ? (parseInt(seasonMax, 10) || number_of_seasons) : number_of_seasons;
    const seasonStart = Math.min(Math.max(1, parsedSeasonMin), number_of_seasons);
    const seasonEnd = Math.max(Math.min(parsedSeasonMax, number_of_seasons), seasonStart);

    let parsedHistory: [number, number][] = [];
    try {
      parsedHistory = JSON.parse(history as string);

      if (parsedHistory.some((element) => !Array.isArray(element) || element.length !== 2 || element.some((subElement) => typeof subElement !== 'number'))) {
        parsedHistory = [];
      }
    } catch {
      // swallow
    }

    const season = await promisify<number, number, number>(randomInt)(seasonStart, seasonEnd + 1);
    const numEpisodes = seasons.find(({ season_number }) => season_number === season)?.episode_count ?? 1;
    const episodeHistory = parsedHistory.filter(([historySeason]) => historySeason === season).map(([historySeason, historyEpisode]) => historyEpisode);

    let episode;
    do {
      episode = await promisify<number, number, number>(randomInt)(1, numEpisodes + 1);
    } while (episodeHistory.length < numEpisodes ? episodeHistory.includes(episode) : episode === episodeHistory[episodeHistory.length - 1]);

    const episodeData = await getEpisodeData(showId, season, episode);

    console.log('show result', {
      requestId,
      season,
      episode
    });

    res.json({
      episode: serializeEpisode(showData, episodeData),
      show: serializeShow(showData)
    });
  } catch (error) {
    if ((error as { errorCode: number; }).errorCode === 404) {
      console.warn('show not found', {
        requestId
      });
      res.sendStatus(404);
      return;
    }

    console.error('error while querying show', {
      requestId,
      error
    });
    res.sendStatus(500);
  }
});

app.get('/episodes/:showId/:season/:episode', async (req, res) => {
  const requestId = await generateId();

  try {
    const { episode, season, showId } = req.params;
    const showData = await getShowData(showId);
    const episodeData = await getEpisodeData(showId, parseInt(season, 10), parseInt(episode, 10));
    res.json({
      episode: serializeEpisode(showData, episodeData),
      show: serializeShow(showData)
    });
  } catch (error) {
    if ((error as { errorCode: number; }).errorCode === 404) {
      res.sendStatus(404);
      return;
    }

    console.error('error while finding episode', {
      requestId,
      error
    });
    res.sendStatus(500);
  }
});

const server = app.listen(parseInt(PORT || '8080', 10), () => {
  const address = server.address() as AddressInfo;
  console.log('listening', {
    port: address.port
  });
});
