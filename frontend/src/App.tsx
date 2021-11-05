import { Component, FormEvent, RefObject, createRef } from 'react';

import Slider from '@mui/material/Slider';
import debounce from 'lodash.debounce';
import Autosuggest, { ChangeEvent, SuggestionsFetchRequestedParams } from 'react-autosuggest';

type PosterUrl = string | null;

interface Suggestion {
  imdbId: string;
  posterUrl: PosterUrl;
  title: string;
  yearEnd: number | null;
  yearStart: number;
}

interface Episode {
  episode: number;
  plot: string;
  posterUrl: PosterUrl;
  season: number;
  title: string;
  totalSeasons: number;
}

interface Props {}

interface State {
  episode: Episode | null;
  episodeInFlight: boolean;
  fetchError: boolean;
  search: string;
  seasonMax: number;
  seasonMin: number;
  selectedSuggestion: Suggestion | null;
  suggestions: Suggestion[];
}

const API_URL = process.env.NODE_ENV === 'development' ? `http://${window.location.hostname}:8080` : '';

class App extends Component<Props, State> {
  autosuggestRef: RefObject<Autosuggest> = createRef();
  handleSuggestionsFetchRequested = debounce(this._handleSuggestionsFetchRequested.bind(this), 500);

  constructor(props: Props) {
    super(props);

    this.state = {
      episode: null,
      episodeInFlight: false,
      fetchError: false,
      search: '',
      seasonMax: 1,
      seasonMin: 1,
      selectedSuggestion: null,
      suggestions: []
    };

    this.fetchEpisode = this.fetchEpisode.bind(this);
    this.handleBodyClick = this.handleBodyClick.bind(this);
    this.handleSearchChange = this.handleSearchChange.bind(this);
    this.renderSuggestion = this.renderSuggestion.bind(this);
  }

  componentDidMount() {
    document.querySelector('body')?.addEventListener('click', this.handleBodyClick);
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

  async fetchEpisode() {
    const { seasonMax, seasonMin, selectedSuggestion } = this.state;
    if (!selectedSuggestion) {
      return;
    }

    this.setState({
      episodeInFlight: true
    });
    try {
      const response = await fetch(`${API_URL}/episode/${selectedSuggestion.imdbId}?seasonMax=${seasonMax}&seasonMin=${seasonMin}`);
      const episode = await response.json();
      await new Promise<void>((resolve) => {
        this.setState({
          episode,
          episodeInFlight: false,
          fetchError: false
        }, () => resolve());
      });
    } catch (error) {
      console.error(error);
      this.setState({
        episodeInFlight: false,
        fetchError: true
      });
    }
  }

  formatRun(yearStart: number, yearEnd: number | null) {
    return `${yearStart} - ${yearEnd ?? 'Present'}`;
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
    });
  }

  handleSuggestionSelected(suggestion: Suggestion) {
    this.setState({
      selectedSuggestion: suggestion,
      suggestions: []
    }, async () => {
      await this.fetchEpisode();
      this.setState({
        seasonMax: this.state.episode?.totalSeasons ?? 1,
        seasonMin: 1
      });
    });
  }

  renderEpisode() {
    const { episode, episodeInFlight, fetchError, seasonMax, seasonMin, selectedSuggestion } = this.state;
    if (episodeInFlight) {
      return <div className="episode colorSecondary">Loading...</div>
    }

    if (fetchError) {
      return <div className="episode colorSecondary">An error occurred, please try again.</div>
    }

    if (!(episode && selectedSuggestion)) {
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
          <button className="backgroundSecondary colorPrimary" onClick={this.fetchEpisode}>Show Me Another!</button>
        </div>
        <div className="heading colorSecondary">{selectedSuggestion.title}</div>
        <div className="subHeading colorSecondary">{this.formatRun(selectedSuggestion.yearStart, selectedSuggestion.yearEnd)}</div>
        <div className="subHeading colorSecondary">Season</div>
        <div className="colorSecondary">{episode.season}</div>
        <div className="subHeading colorSecondary">Episode</div>
        <div className="colorSecondary">{episode.episode}</div>
        <div className="subHeading colorSecondary">Title</div>
        <div className="colorSecondary">{episode.title ?? 'Missing'}</div>
        <div className="subHeading colorSecondary">Plot</div>
        <div className="colorSecondary">{episode.plot ?? 'Missing'}</div>
        {episode.posterUrl && (
          <img alt={`Poster for Season ${episode.season} Episode ${episode.episode} of ${selectedSuggestion.title}`} src={episode.posterUrl} />
        )}
      </div>
    )
  }

  renderSuggestion({ posterUrl, title, yearEnd, yearStart }: Suggestion) {
    return (
      <>
        <div className="poster">
          {posterUrl && <img alt={`Poster for ${title}`} src={posterUrl} />}
        </div>
        {title} ({this.formatRun(yearStart, yearEnd)})
      </>
    );
  }

  render() {
    const { search, suggestions } = this.state;
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
                onChange: this.handleSearchChange,
                placeholder: 'Search for a TV show...',
                value: search
              }}
              onSuggestionsFetchRequested={this.handleSuggestionsFetchRequested}
              onSuggestionSelected={(event, data) => this.handleSuggestionSelected(data.suggestion)}
              ref={this.autosuggestRef}
              renderSuggestion={this.renderSuggestion}
              suggestions={suggestions}
            />
            {this.renderEpisode()}
          </div>
        </div>
        <div className="footer colorSecondary">
          Made by <a className="colorSecondary" href="https://deanlevinson.com.au" rel="noreferrer" target="_blank">Dean Levinson</a> | <a className="colorSecondary" href="https://github.com/deanylev/what-episode-should-i-watch" rel="noreferrer" target="_blank">Source</a>
        </div>
      </div>
    );
  }
}

export default App;
