import { Component, FormEvent, RefObject, createRef } from 'react';

import Slider from '@mui/material/Slider';
import Autosuggest, { ChangeEvent, SuggestionsFetchRequestedParams } from 'react-autosuggest';

type PosterUrl = string | null;

interface Suggestion {
  disabled?: boolean;
  id: string;
  popularity: number;
  posterUrl: PosterUrl;
  title: string;
  yearStart: string;
}

interface Episode {
  episode: number;
  plot: string;
  posterUrl: PosterUrl;
  rating: string;
  season: number;
  showYearEnd: string | null;
  title: string;
  totalSeasons: number;
}

interface Props {}

interface State {
  episode: Episode | null;
  episodeHistory: [number, number][];
  episodeHistoryFull: Episode[];
  episodePosterInFlight: boolean;
  fetchError: boolean;
  hideSuggestions: boolean;
  inFlight: boolean;
  search: string;
  searchDebounceTimeout: number | null;
  searchInFlight: boolean;
  seasonMax: number;
  seasonMin: number;
  selectedSuggestion: Suggestion | null;
  suggestions: Suggestion[];
}

const isDev = process.env.NODE_ENV === 'development';
const API_URL = isDev ? `http://${window.location.hostname}:8080` : '';

const SEARCH_DEBOUNCE_INTERVAL = 500;
const STORAGE_KEY_SHOWS = 'seasonRangeById';

class App extends Component<Props, State> {
  autosuggestRef: RefObject<Autosuggest> = createRef();
  debouncePromise = Promise.resolve();

  get currentEpisodeIndex() {
    const { episode, episodeHistoryFull } = this.state;
    if (!episode) {
      return -1;
    }
    return episodeHistoryFull.indexOf(episode);
  }

  get initialState(): State {
    return {
      episode: null,
      episodeHistory: [],
      episodeHistoryFull: [],
      episodePosterInFlight: false,
      fetchError: false,
      hideSuggestions: false,
      inFlight: false,
      search: '',
      searchDebounceTimeout: null,
      searchInFlight: false,
      seasonMax: 1,
      seasonMin: 1,
      selectedSuggestion: null,
      suggestions: []
    };
  }

  constructor(props: Props) {
    super(props);

    this.state = this.initialState;

    this.handleBodyClick = this.handleBodyClick.bind(this);
    this.handleSearchChange = this.handleSearchChange.bind(this);
    this.handleSuggestionsFetchRequested = this.handleSuggestionsFetchRequested.bind(this);
    this.renderSuggestion = this.renderSuggestion.bind(this);
  }

  componentDidMount() {
    document.querySelector('body')?.addEventListener('click', this.handleBodyClick);
    this.fetchFromParams();
  }

  componentWillUnmount() {
    document.querySelector('body')?.removeEventListener('click', this.handleBodyClick);
  }

  async _handleSuggestionsFetchRequested({ reason, value }: SuggestionsFetchRequestedParams) {
    if (reason === 'suggestion-selected') {
      return;
    }

    if (reason === 'input-focused' && this.state.suggestions.length > 0) {
      this.setState({
        hideSuggestions: false,
      });
      return;
    }

    const trimmedSearch = value.trim().toLowerCase();
    if (!trimmedSearch) {
      this.setState({
        suggestions: []
      });
      return;
    }

    this.setState({
      hideSuggestions: false,
      searchInFlight: true
    });

    try {
      const response = await fetch(`${API_URL}/shows?q=${trimmedSearch}`);
      const suggestions: Suggestion[] = await response.json();
      suggestions.sort((a, b) => {
        // prioritise the greatest comedy of all time
        if (trimmedSearch === 'peep') {
          const peepShow = [a, b].find(({ id }) => id === '815');
          if (peepShow) {
            return peepShow === a ? -1 : 1;
          }
        }

        return b.popularity - a.popularity;
      });
      this.setState({
        fetchError: false,
        suggestions
      });
    } catch (error) {
      console.error(error);
      this.setState({
        fetchError: true,
        suggestions: []
      });
    } finally {
      this.setState({
        searchInFlight: false
      });
    }
  }

  addShowToStorage(totalSeasons: number) {
    const { seasonMax, seasonMin, selectedSuggestion } = this.state;
    if (!selectedSuggestion) {
      return;
    }

    const storedShows = this.getStoredShows();
    if (seasonMin === 1 && seasonMax === totalSeasons) {
      delete storedShows[selectedSuggestion.id];
    } else {
      storedShows[selectedSuggestion.id] = [seasonMin, seasonMax];
    }

    localStorage.setItem(STORAGE_KEY_SHOWS, JSON.stringify(storedShows));
  }

  async fetchEpisode(hasStored = false) {
    const { episode, episodeHistory, seasonMax, seasonMin, selectedSuggestion } = this.state;
    if (!selectedSuggestion) {
      return;
    }

    this.setState({
      inFlight: true
    });
    try {
      const response = await fetch(`${API_URL}/episodes/${selectedSuggestion.id}?seasonMin=${seasonMin}${(episode || hasStored) ? `&seasonMax=${seasonMax}` : ''}&history=${encodeURIComponent(JSON.stringify(episodeHistory))}`);
      const { episode: newEpisode } = await response.json();
      this.setEpisodeState(selectedSuggestion.id, newEpisode);
    } catch (error) {
      console.error(error);
      this.setState({
        fetchError: true,
        inFlight: false
      });
    }
  }

  async fetchFromParams() {
    const urlSearchParams = new URLSearchParams(window.location.search);
    const id = urlSearchParams.get('id');
    const season = urlSearchParams.get('season');
    const episode = urlSearchParams.get('episode');
    if (!id) {
      return;
    }
    this.setState({
      inFlight: true
    });
    try {
      const episodeResponse = season && episode
        ? await fetch(`${API_URL}/episodes/${id}/${season}/${episode}`)
        : await fetch(`${API_URL}/episodes/${id}`);
      const { episode: episodeData, show: showData, } = await episodeResponse.json()
      this.setState({
        search: showData.title
      });
      this.handleSuggestionSelected(showData, () => this.setEpisodeState(id, episodeData));
    } catch (error) {
      console.error(error);
      this.setState({
        fetchError: true
      });
    } finally {
      this.setState({
        inFlight: false
      });
    }
  }

  formatRun(yearStart: string, yearEnd: string | null) {
    return `${yearStart} - ${yearEnd ?? 'Present'}`;
  }

  getEpisodeHistory(newEpisode: Episode): [number, number][] {
    const { episodeHistory } = this.state;
    const seen = episodeHistory.some(([season, episode]) => season === newEpisode.season && episode === newEpisode.episode);
    return [
      ...seen ? episodeHistory.filter(([season]) => season !== newEpisode.season) : episodeHistory,
      [newEpisode.season, newEpisode.episode]
    ];
  }

  getStoredShows(): Record<string, number[]> {
    const storedValue = localStorage.getItem(STORAGE_KEY_SHOWS);
    try {
      return JSON.parse(storedValue ?? '{}');
    } catch {
      return {};
    }
  }

  goNextEpisode() {
    const { episode, episodeHistoryFull, selectedSuggestion } = this.state;
    if (!episode || !selectedSuggestion) {
      return;
    }

    this.setEpisodeState(selectedSuggestion.id, episodeHistoryFull[this.currentEpisodeIndex + 1]);
  }

  goPrevEpisode() {
    const { episode, episodeHistoryFull, selectedSuggestion } = this.state;
    if (!episode || !selectedSuggestion) {
      return;
    }

    this.setEpisodeState(selectedSuggestion.id, episodeHistoryFull[this.currentEpisodeIndex - 1]);
  }

  handleBodyClick(event: Event) {
    const { current: { input, suggestionsContainer } } = this.autosuggestRef as unknown as { current: { input: HTMLInputElement; suggestionsContainer: HTMLDivElement } };
    const composedPath = event.composedPath();
    if (composedPath.includes(suggestionsContainer) || composedPath.includes(input)) {
      return;
    }

    this.setState({
      hideSuggestions: true
    });
  }

  handleSearchChange(event: FormEvent<HTMLElement>, { newValue }: ChangeEvent) {
    this.setState({
      search: newValue
    });
  }

  handleSeasonRangeChange(totalSeasons: number, [seasonMin, seasonMax]: number[]) {
    this.setState({
      seasonMax,
      seasonMin
    }, () => {
      this.addShowToStorage(totalSeasons);
    });
  }

  handleSuggestionsFetchRequested(params: SuggestionsFetchRequestedParams) {
    this.debouncePromise = this.debouncePromise.then(async () => {
      const { searchDebounceTimeout } = this.state;
      if (searchDebounceTimeout !== null) {
        clearTimeout(searchDebounceTimeout);
        await new Promise<void>((resolve) => {
          this.setState({
            searchDebounceTimeout: null
          }, resolve);
        });
      }

      await new Promise<void>((resolve) => {
        this.setState({
          searchDebounceTimeout: window.setTimeout(() => {
            this._handleSuggestionsFetchRequested(params);
            this.setState({
              searchDebounceTimeout: null
            });
          }, SEARCH_DEBOUNCE_INTERVAL)
        }, resolve);
      });
    });
  }

  handleSuggestionSelected(suggestion: Suggestion, callback?: (hasStored: boolean) => Promise<void> | void) {
    if (suggestion.disabled) {
      return;
    }

    const [seasonMin, seasonMax] = this.getStoredShows()[suggestion.id] ?? [];
    const hasStored = !!(seasonMin && seasonMax)
    this.setState({
      episodeHistory: [],
      episodeHistoryFull: [],
      hideSuggestions: true,
      seasonMax: seasonMax ?? this.state.seasonMax,
      seasonMin: seasonMin ?? this.state.seasonMin,
      selectedSuggestion: suggestion
    }, async () => {
      await callback?.(hasStored);
      if (!hasStored) {
        this.setState({
          seasonMax: this.state.episode?.totalSeasons ?? 1,
          seasonMin: 1
        });
      }
    });
  }

  renderEpisode() {
    const { episode, episodeHistoryFull, episodePosterInFlight, fetchError, inFlight, seasonMax, seasonMin, selectedSuggestion } = this.state;
    if (inFlight) {
      return <div className="episode colorSecondary">Loading...</div>;
    }

    if (fetchError) {
      return <div className="episode colorSecondary">An error occurred, please try again</div>;
    }

    if (!episode || !selectedSuggestion) {
      return;
    }

    return (
      <div className="episode">
        <div className="controls">
          <Slider
            disableSwap
            marks
            max={episode.totalSeasons}
            min={1}
            onChange={(event, newValue) => this.handleSeasonRangeChange(episode.totalSeasons, newValue as number[])}
            value={[seasonMin, seasonMax]}
            valueLabelDisplay="on"
            valueLabelFormat={(value) => `Season ${value}`}
          />
          <button className="backgroundSecondary colorPrimary" onClick={() => this.fetchEpisode()}>Another!</button>
        </div>
        <div className="details">
          <div className="text">
            <span className="heading colorSecondary">
              <a className="colorSecondary" href={`https://www.themoviedb.org/tv/${selectedSuggestion.id}`} rel="noreferrer" target="_blank">{selectedSuggestion.title}</a> ({this.formatRun(selectedSuggestion.yearStart, episode.showYearEnd)})
            </span>
            <div className="buttons">
              <button disabled={this.currentEpisodeIndex === 0} onClick={() => this.goPrevEpisode()}>👈 Go Back</button>
              <button disabled={this.currentEpisodeIndex === episodeHistoryFull.length - 1} onClick={() => this.goNextEpisode()}>👉 Go Forward</button>
            </div>
            <div className="subHeading colorSecondary">Episode</div>
            <div className="colorSecondary">Season {episode.season}, Episode {episode.episode} {(episode.title && `- ${episode.title}`) || ''}</div>
            <div className="subHeading colorSecondary">TMDB Rating</div>
            <a className="colorSecondary" href={`https://www.themoviedb.org/tv/${selectedSuggestion.id}/season/${episode.season}/episode/${episode.episode}`} rel="noreferrer" target="_blank">{episode.rating}</a>
            <div className="subHeading colorSecondary">Plot</div>
            <div className="colorSecondary">{episode.plot || 'Missing'}</div>
          </div>
          {episode.posterUrl && (
            <div className="poster">
              <img
                alt={`Poster for Season ${episode.season} Episode ${episode.episode} of ${selectedSuggestion.title}`}
                className={episodePosterInFlight ? 'inFlight' : ''}
                onLoad={() => this.setState({ episodePosterInFlight: false })}
                src={episode.posterUrl}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  renderSuggestion({ disabled, posterUrl, title, yearStart }: Suggestion) {
    return (
      <>
        {!disabled && (
          <div className="poster">
            {posterUrl && <img alt={`Poster for ${title}`} src={posterUrl} />}
          </div>
        )}
        {title}{yearStart ? ` (${yearStart})` : ''}
      </>
    );
  }

  render() {
    const { hideSuggestions, inFlight, search, searchDebounceTimeout, searchInFlight, suggestions: cachedSuggestions } = this.state;
    const loadingSuggestion: Suggestion = {
      disabled: true,
      id: 'loading',
      popularity: 0,
      posterUrl: null,
      title: 'Loading...',
      yearStart: '',
    };
    const noResultsSuggestion: Suggestion = {
      disabled: true,
      id: 'no-results',
      popularity: 0,
      posterUrl: null,
      title: 'No Results',
      yearStart: ''
    };
    const getSuggestions = () => {
      if (searchInFlight) {
        return [loadingSuggestion];
      }

      if (!search.trim() || searchDebounceTimeout !== null) {
        return [];
      }

      if (cachedSuggestions.length === 0) {
        return [noResultsSuggestion];
      }

      if (hideSuggestions) {
        return [];
      }

      return cachedSuggestions;
    };
    const suggestions = getSuggestions();
    const disabledSuggestion = !!suggestions[0]?.disabled;
    return (
      <div className="App">
        <div className="body">
          <button className="heading colorSecondary" onClick={() => this.resetState()}>What Episode Should I Watch?</button>
          <div className="content">
            <Autosuggest
              containerProps={{
                'data-disabled': disabledSuggestion.toString()
              } as Autosuggest.ContainerProps}
              focusInputOnSuggestionClick={false}
              getSuggestionValue={(suggestion) => disabledSuggestion ? search : suggestion.title}
              inputProps={{
                disabled: inFlight,
                onChange: this.handleSearchChange,
                placeholder: 'Search for a TV show...',
                value: search
              }}
              onSuggestionsFetchRequested={this.handleSuggestionsFetchRequested}
              onSuggestionSelected={(event, data) => this.handleSuggestionSelected(data.suggestion, (hasStored) => this.fetchEpisode(hasStored))}
              ref={this.autosuggestRef}
              renderSuggestion={this.renderSuggestion}
              suggestions={suggestions}
            />
            {this.renderEpisode()}
          </div>
        </div>
        <div className="footer colorSecondary">
          {isDev && 'DEV BUILD | '}
          Made by <a className="colorSecondary" href="https://deanlevinson.com.au" rel="noreferrer" target="_blank">Dean Levinson</a> | <a className="colorSecondary" href="https://github.com/deanylev/what-episode-should-i-watch" rel="noreferrer" target="_blank">Source</a>
        </div>
      </div>
    );
  }

  resetState() {
    this.setState(this.initialState);
    window.history.replaceState(null, '', window.location.pathname);
  }

  async setEpisodeState(showId: string, episode: Episode) {
    const { episodeHistoryFull } = this.state;
    const state: State = {
      ...this.state,
      episode,
      episodePosterInFlight: !!episode.posterUrl,
      fetchError: false,
      inFlight: false
    };
    if (!episodeHistoryFull.includes(episode)) {
      state.episodeHistory = this.getEpisodeHistory(episode);
      state.episodeHistoryFull = [...this.state.episodeHistoryFull, episode];
    }

    await new Promise<void>((resolve) => this.setState(state, resolve));
    const urlSearchParams = new URLSearchParams();
    urlSearchParams.set('id', showId);
    urlSearchParams.set('season', episode.season.toString());
    urlSearchParams.set('episode', episode.episode.toString());
    window.history.replaceState(null, '', `${window.location.pathname}?${urlSearchParams.toString()}`);
  }
}

export default App;
