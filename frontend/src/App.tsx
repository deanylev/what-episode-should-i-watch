import { Component, FormEvent, RefObject, createRef } from 'react';

import Slider from '@mui/material/Slider';
import debounce from 'lodash.debounce';
import Autosuggest, { ChangeEvent, SuggestionsFetchRequestedParams } from 'react-autosuggest';

type PosterUrl = string | null;

interface Suggestion {
  id: string;
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
  fetchError: boolean;
  inFlight: boolean;
  search: string;
  seasonMax: number;
  seasonMin: number;
  selectedSuggestion: Suggestion | null;
  suggestions: Suggestion[];
}

const isDev = process.env.NODE_ENV === 'development';
const API_URL = isDev ? `http://${window.location.hostname}:8080` : '';

const STORAGE_KEY_SHOWS = 'seasonRangeById';

class App extends Component<Props, State> {
  autosuggestRef: RefObject<Autosuggest> = createRef();
  handleSuggestionsFetchRequested = debounce(this._handleSuggestionsFetchRequested.bind(this), 500);

  constructor(props: Props) {
    super(props);

    this.state = {
      episode: null,
      episodeHistory: [],
      fetchError: false,
      inFlight: false,
      search: '',
      seasonMax: 1,
      seasonMin: 1,
      selectedSuggestion: null,
      suggestions: []
    };

    this.handleBodyClick = this.handleBodyClick.bind(this);
    this.handleSearchChange = this.handleSearchChange.bind(this);
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

    const trimmedSearch = value.trim();
    if (!trimmedSearch) {
      this.setState({
        suggestions: []
      });
      return;
    }

    try {
      const response = await fetch(`${API_URL}/shows?q=${trimmedSearch}`);
      const suggestions = await response.json();
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
    }
  }

  addShowToStorage() {
    const { seasonMax, seasonMin, selectedSuggestion } = this.state;
    if (!selectedSuggestion) {
      return;
    }

    const storedShows = this.getStoredShows();
    storedShows[selectedSuggestion.id] = [seasonMin, seasonMax];
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
      const newEpisode = await response.json();
      await new Promise<void>((resolve) => {
        this.setState({
          episode: newEpisode,
          episodeHistory: this.getEpisodeHistory(newEpisode),
          fetchError: false,
          inFlight: false
        }, () => resolve());
      });
      const urlSearchParams = new URLSearchParams();
      urlSearchParams.set('id', selectedSuggestion.id);
      urlSearchParams.set('season', newEpisode.season);
      urlSearchParams.set('episode', newEpisode.episode);
      window.history.replaceState(null, '', `${window.location.pathname}?${urlSearchParams.toString()}`);
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
    if (!(id && season && episode)) {
      return;
    }
    this.setState({
      inFlight: true
    });
    try {
      const suggestionResponse = await fetch(`${API_URL}/shows/${id}`);
      const suggestionData = await suggestionResponse.json();
      const episodeResponse = await fetch(`${API_URL}/episodes/${id}/${season}/${episode}`);
      const episodeData = await episodeResponse.json()
      this.handleSuggestionSelected(suggestionData, () => new Promise((resolve) => {
        this.setState({
          episode: episodeData,
          episodeHistory: this.getEpisodeHistory(episodeData),
          search: suggestionData.title
        }, resolve);
      }));
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

  handleBodyClick(event: Event) {
    const autosuggestRef = this.autosuggestRef as unknown as { current: { suggestionsContainer: HTMLDivElement } };
    if (event.composedPath().includes(autosuggestRef.current.suggestionsContainer)) {
      return;
    }

    this.setState({
      suggestions: []
    });
  }

  handleSearchChange(event: FormEvent<HTMLElement>, { newValue }: ChangeEvent) {
    this.setState({
      search: newValue
    });
  }

  handleSeasonRangeChange([seasonMin, seasonMax]: number[]) {
    this.setState({
      seasonMax,
      seasonMin
    }, () => {
      this.addShowToStorage();
    });
  }

  handleSuggestionSelected(suggestion: Suggestion, callback: (hasStored: boolean) => Promise<void>) {
    const [seasonMin, seasonMax] = this.getStoredShows()[suggestion.id] ?? [];
    const hasStored = !!(seasonMin && seasonMax)
    this.setState({
      episodeHistory: [],
      seasonMax: seasonMax ?? this.state.seasonMax,
      seasonMin: seasonMin ?? this.state.seasonMin,
      selectedSuggestion: suggestion,
      suggestions: []
    }, async () => {
      await callback(hasStored);
      if (!hasStored) {
        this.setState({
          seasonMax: this.state.episode?.totalSeasons ?? 1,
          seasonMin: 1
        });
      }
    });
  }

  renderEpisode() {
    const { episode, fetchError, inFlight, seasonMax, seasonMin, selectedSuggestion } = this.state;
    if (fetchError || inFlight || !episode || !selectedSuggestion) {
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
            onChange={(event, newValue) => this.handleSeasonRangeChange(newValue as number[])}
            value={[seasonMin, seasonMax]}
            valueLabelDisplay="on"
            valueLabelFormat={(value) => `Season ${value}`}
          />
          <button className="backgroundSecondary colorPrimary" onClick={() => this.fetchEpisode()}>Show Me Another!</button>
        </div>
        <a className="heading colorSecondary" href={`https://www.themoviedb.org/tv/${selectedSuggestion.id}`} rel="noreferrer" target="_blank">{selectedSuggestion.title} ({this.formatRun(selectedSuggestion.yearStart, episode.showYearEnd)})</a>
        <div className="subHeading colorSecondary">Episode</div>
        <div className="colorSecondary">Season {episode.season}, Episode {episode.episode} {(episode.title && `- ${episode.title}`) || ''}</div>
        <div className="subHeading colorSecondary">TMDB Rating</div>
        <a className="colorSecondary" href={`https://www.themoviedb.org/tv/${selectedSuggestion.id}/season/${episode.season}/episode/${episode.episode}`} rel="noreferrer" target="_blank">{episode.rating}</a>
        <div className="subHeading colorSecondary">Plot</div>
        <div className="colorSecondary">{episode.plot || 'Missing'}</div>
        {episode.posterUrl && (
          <img alt={`Poster for Season ${episode.season} Episode ${episode.episode} of ${selectedSuggestion.title}`} src={episode.posterUrl} />
        )}
      </div>
    )
  }

  renderSuggestion({ posterUrl, title, yearStart }: Suggestion) {
    return (
      <>
        <div className="poster">
          {posterUrl && <img alt={`Poster for ${title}`} src={posterUrl} />}
        </div>
        {title} ({yearStart})
      </>
    );
  }

  render() {
    const { fetchError, inFlight, search, suggestions } = this.state;
    return (
      <div className="App">
        <div className="body">
          <div className="heading colorSecondary">What Episode Should I Watch?</div>
          <div className="content">
            <Autosuggest
              alwaysRenderSuggestions
              focusInputOnSuggestionClick={false}
              getSuggestionValue={(suggestion) => suggestion.title}
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
            {inFlight ? (
              <div className="episode colorSecondary">Loading...</div>
            ) : fetchError ? (
              <div className="episode colorSecondary">An error occurred, please try again.</div>
            ) : <></>}
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
}

export default App;
