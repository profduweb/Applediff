'use strict';

const feedUrl = document.querySelector('link[type="application/rss+xml"]').href;
const itunesNamespace = 'http://www.itunes.com/dtds/podcast-1.0.dtd';
const dateFormat = new Intl.DateTimeFormat('fr', { dateStyle: 'long', timeZone: 'UTC' });
const allowedNotes = new Set(['a', 'b', 'blockquote', 'br', 'em', 'i', 'li', 'ol', 'p', 'strong', 'ul']);
const discardedNotes = new Set(['embed', 'iframe', 'object', 'script', 'style', 'template']);

const featured = document.querySelector('.featured');
const featuredCover = document.querySelector('#featured-cover');
const defaultCover = featuredCover.src;
const featuredPlay = document.querySelector('#featured-play');
const catalog = document.querySelector('#catalog');
const list = document.querySelector('#episode-list');
const episodeTemplate = document.querySelector('#episode-template');
const search = document.querySelector('#search');
const results = document.querySelector('#results');
const feedState = document.querySelector('#feed-state');
const feedStatus = document.querySelector('#feed-status');
const feedRecovery = document.querySelector('#feed-recovery');
const player = document.querySelector('#player');
const playerCover = document.querySelector('#player-cover');
const playerStatus = document.querySelector('#player-status');
const audio = document.querySelector('#audio');
const nowPlaying = document.querySelector('#now-playing');
const closePlayer = document.querySelector('#close-player');
const playbackError = document.querySelector('#playback-error');
const audioLink = document.querySelector('#audio-link');

let episodes = [];
let currentEpisode;
let lastPlayButton;

function webUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function normalizeTitle(value) {
    return value.normalize('NFD').replace(/\p{Mark}/gu, '').toLocaleLowerCase('fr').trim();
}

function formatDuration(value) {
    if (!/^\d+(?::\d{1,2}){0,2}$/.test(value)) return '';

    const seconds = value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const parts = [];
    if (hours) parts.push(hours + '\u00a0h');
    if (minutes) parts.push(minutes + '\u00a0min');
    return parts.join(' ') || seconds + '\u00a0s';
}

function parseFeed(xml) {
    const channel = new DOMParser().parseFromString(xml, 'application/xml').querySelector('rss > channel');
    if (!channel) throw new Error('Flux RSS invalide');

    return Array.from(channel.querySelectorAll(':scope > item'), item => {
        const title = item.querySelector('title')?.textContent.trim();
        const source = webUrl(item.querySelector('enclosure')?.getAttribute('url'));
        if (!title || !source) return null;

        const published = Date.parse(item.querySelector('pubDate')?.textContent);
        const date = Number.isFinite(published) ? dateFormat.format(published) : '';
        const duration = item.getElementsByTagNameNS(itunesNamespace, 'duration')[0]?.textContent.trim() ?? '';
        const cover = item.getElementsByTagNameNS(itunesNamespace, 'image')[0]?.getAttribute('href');
        return {
            title,
            searchTitle: normalizeTitle(title),
            source,
            cover: webUrl(cover),
            published: published || 0,
            metadata: [date, formatDuration(duration)].filter(Boolean).join(' · '),
            notes: item.querySelector('description')?.textContent.trim() ?? '',
        };
    }).filter(Boolean).sort((first, second) => second.published - first.published);
}

function renderNotes(html, destination) {
    // The template is inert. Copy only the tags and link URLs used in show notes.
    const template = document.createElement('template');
    template.innerHTML = html;

    function copy(node, parent) {
        if (node.nodeType === Node.TEXT_NODE) {
            parent.append(node.textContent);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || discardedNotes.has(node.localName)) return;

        const tag = node.localName;
        const href = tag === 'a' ? webUrl(node.getAttribute('href')) : '';
        let target = parent;
        if (allowedNotes.has(tag) && (tag !== 'a' || href)) {
            target = document.createElement(tag);
            if (href) target.href = href;
            parent.append(target);
        }
        node.childNodes.forEach(child => copy(child, target));
    }

    template.content.childNodes.forEach(node => copy(node, destination));
}

function updatePlayButton(button, episode, idleLabel) {
    const isPlaying = episode === currentEpisode && !audio.paused && !audio.ended;
    const label = isPlaying ? 'Mettre en pause' : idleLabel;
    button.classList.toggle('is-playing', isPlaying);
    button.querySelector('.play-label').textContent = label;
    button.setAttribute('aria-label', label + ' — ' + episode.title);
}

function updatePlayerState() {
    if (!episodes.length) return;

    if (currentEpisode) {
        if (audio.ended) {
            playerStatus.textContent = 'Épisode terminé';
        } else {
            playerStatus.textContent = audio.paused ? 'En pause' : 'En cours d’écoute';
        }
    }

    updatePlayButton(featuredPlay, episodes[0], 'Écouter l’épisode');
    for (const episode of episodes) {
        episode.row.classList.toggle('is-selected', episode === currentEpisode);
        updatePlayButton(episode.button, episode, 'Écouter');
    }
}

function togglePlayback(episode, button) {
    lastPlayButton = button;
    if (episode === currentEpisode && !audio.paused && !audio.ended) {
        audio.pause();
        return;
    }

    if (episode !== currentEpisode) {
        currentEpisode = episode;
        audio.src = episode.source;
        audioLink.href = episode.source;
        playerCover.src = episode.cover || defaultCover;
        nowPlaying.textContent = episode.title;
        nowPlaying.title = episode.title;
        player.hidden = false;
    }

    playbackError.hidden = true;
    if (audio.error) audio.load();
    const playback = audio.play();
    updatePlayerState();
    playback.catch(error => {
        if (episode === currentEpisode && error.name !== 'AbortError') {
            playbackError.hidden = false;
            updatePlayerState();
        }
    });
}

function renderEpisode(episode) {
    const row = episodeTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector('h3').textContent = episode.title;
    row.querySelector('.episode-meta').textContent = episode.metadata;

    episode.row = row;
    episode.button = row.querySelector('.play-button');
    episode.button.addEventListener('click', () => togglePlayback(episode, episode.button));

    const details = row.querySelector('details');
    if (episode.notes) {
        details.addEventListener('toggle', () => {
            renderNotes(episode.notes, details.querySelector('.notes-content'));
        }, { once: true });
    } else {
        details.remove();
    }
    return row;
}

function filterEpisodes() {
    const query = normalizeTitle(search.value);
    let count = 0;
    for (const episode of episodes) {
        const matches = episode.searchTitle.includes(query);
        episode.row.hidden = !matches;
        if (matches) count += 1;
    }
    results.textContent = count
        ? count + (count === 1 ? ' épisode' : ' épisodes')
        : 'Aucun épisode ne correspond à cette recherche.';
}

function showEpisodes() {
    const latest = episodes[0];
    featuredCover.src = latest.cover || defaultCover;
    document.querySelector('#featured-title').textContent = latest.title;
    document.querySelector('#featured-meta').textContent = latest.metadata;
    list.replaceChildren(...episodes.map(renderEpisode));
    updatePlayerState();
    filterEpisodes();
    featured.hidden = false;
    catalog.hidden = false;
    feedState.hidden = true;
}

async function loadEpisodes() {
    feedRecovery.hidden = true;
    feedStatus.textContent = 'Chargement des épisodes…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(feedUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('Flux RSS indisponible');
        episodes = parseFeed(await response.text());
        if (!episodes.length) throw new Error('Aucun épisode disponible');
        showEpisodes();
    } catch {
        feedStatus.textContent = 'Les épisodes sont momentanément indisponibles.';
        feedRecovery.hidden = false;
    } finally {
        clearTimeout(timeout);
    }
}

for (const event of ['play', 'pause', 'ended', 'emptied']) {
    audio.addEventListener(event, updatePlayerState);
}
for (const cover of [featuredCover, playerCover]) {
    cover.addEventListener('error', () => {
        if (cover.src !== defaultCover) cover.src = defaultCover;
    });
}
audio.addEventListener('error', () => {
    if (!currentEpisode) return;
    playbackError.hidden = false;
    updatePlayerState();
});

closePlayer.addEventListener('click', () => {
    currentEpisode = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    player.hidden = true;
    updatePlayerState();
    const focusTarget = lastPlayButton?.closest('[hidden]') ? search : lastPlayButton;
    focusTarget?.focus({ preventScroll: true });
});

featuredPlay.addEventListener('click', () => togglePlayback(episodes[0], featuredPlay));
search.addEventListener('input', filterEpisodes);
document.querySelector('#retry').addEventListener('click', loadEpisodes);
loadEpisodes();
