import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

declare global {
    interface Window {
        YT: any;
        onYouTubeIframeAPIReady: () => void;
    }
}

const initialVideo = { id: Date.now(), url: '', loop: 0, delay: 0 };
const initialSchedule = Array.from({ length: 5 }, (_, i) => ({ id: i, startTime: '', stopTime: '' }));

const App = () => {
    const [videos, setVideos] = useState([initialVideo]);
    const [schedule, setSchedule] = useState(initialSchedule);
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [status, setStatus] = useState('Ready. Add videos to start.');
    const [isPlaying, setIsPlaying] = useState(false);
    const [isApiReady, setIsApiReady] = useState(false);
    const [currentPlayingId, setCurrentPlayingId] = useState(null);
    
    const playersRef = useRef<{ [id: string]: any }>({});
    const playerReadyStatusRef = useRef<{ [id: string]: boolean }>({});
    const currentVideoIndexRef = useRef(0);
    const loopCountRef = useRef(0);
    const scheduleIntervalRef = useRef(null);

    const updateVideo = (id, field, value) => {
        setVideos(videos.map(v => v.id === id ? { ...v, [field]: value } : v));
    };

    const addVideo = () => {
        setVideos([...videos, { id: Date.now(), url: '', loop: 0, delay: 0 }]);
    };

    const removeVideo = (idToRemove) => {
        // Stop playback if the removed video is the one playing
        if (idToRemove === currentPlayingId) {
            stopPlayback('Stopped because the playing video was removed.');
        }
        // Clean up player ready status
        delete playerReadyStatusRef.current[idToRemove];
        setVideos(videos.filter(v => v.id !== idToRemove));
    };
    
    const updateSchedule = (id, field, value) => {
        setSchedule(schedule.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    const parseYouTubeUrl = (url) => {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            let videoId = urlObj.searchParams.get('v');
            let listId = urlObj.searchParams.get('list');
            if (urlObj.hostname.includes('youtu.be')) {
                videoId = urlObj.pathname.split('?')[0].slice(1);
            }
            return { videoId, listId };
        } catch (e) {
            return null;
        }
    };
    
    const stopPlayback = useCallback((message = 'Stopped.') => {
        if (currentPlayingId && playersRef.current[currentPlayingId]) {
            playersRef.current[currentPlayingId].stopVideo();
        }
        setIsPlaying(false);
        setCurrentPlayingId(null);
        setStatus(message);
        currentVideoIndexRef.current = 0;
        loopCountRef.current = 0;
        if (scheduleIntervalRef.current) {
            clearInterval(scheduleIntervalRef.current);
            scheduleIntervalRef.current = null;
        }
    }, [currentPlayingId]);
    
    const playNextVideo = useCallback(() => {
        const validVideos = videos.filter(v => v.url);
        if (validVideos.length === 0) {
            stopPlayback('No valid videos in the list.');
            return;
        }
        currentVideoIndexRef.current = (currentVideoIndexRef.current + 1) % validVideos.length;
        loopCountRef.current = 0;
        playVideo();
    }, [videos, stopPlayback]);

    const onPlayerError = useCallback((event) => {
        console.error("YT Player Error:", event.data);
        setStatus(`Error playing video. Skipping.`);
        setTimeout(playNextVideo, 3000);
    }, [playNextVideo]);

    const onPlayerReady = useCallback((event, videoId) => {
        playerReadyStatusRef.current[videoId] = true;
        // If this is the player we're waiting for, start playing
        const validVideos = videos.filter(v => v.url);
        if (validVideos.length > 0 && validVideos[currentVideoIndexRef.current]?.id === videoId && isPlaying) {
            playVideo();
        }
    }, [videos, isPlaying]);

    const onPlayerStateChange = useCallback((event) => {
        const playerInstance = event.target;
        let playingVideoId = null;

        for (const id in playersRef.current) {
            if (playersRef.current[id] === playerInstance) {
                playingVideoId = Number(id);
                break;
            }
        }
        
        if (!playingVideoId || playingVideoId !== currentPlayingId) {
            // Ignore events from non-active players
            return;
        }

        const currentVideo = videos.find(v => v.id === playingVideoId);

        if (event.data === window.YT.PlayerState.ENDED) {
            const maxLoops = currentVideo.loop === 0 ? Infinity : currentVideo.loop;
            
            if (loopCountRef.current < maxLoops - 1) {
                loopCountRef.current++;
                playerInstance.playVideo();
            } else {
                setStatus(`Finished playing. Delaying for ${currentVideo.delay}s...`);
                setTimeout(() => {
                    playNextVideo();
                }, currentVideo.delay * 1000);
            }
        } else if (event.data === window.YT.PlayerState.PLAYING) {
            const videoData = playerInstance.getVideoData();
            const title = videoData.title || currentVideo.url;
            setStatus(`Playing: ${title}`);
        } else if (event.data === window.YT.PlayerState.PAUSED) {
            setStatus('Paused.');
        }
    }, [videos, playNextVideo, currentPlayingId]);
    
    const playVideo = () => {
        const validVideos = videos.filter(v => v.url);
        if (validVideos.length === 0) {
            setStatus('No valid videos to play.');
            setIsPlaying(false);
            return;
        }

        const videoToPlay = validVideos[currentVideoIndexRef.current];
        const player = playersRef.current[videoToPlay.id];
        const isPlayerReady = playerReadyStatusRef.current[videoToPlay.id];

        if (!player || !isPlayerReady) {
             setStatus(`Player for ${videoToPlay.url} not ready. Skipping.`);
             setTimeout(playNextVideo, 2000);
             return;
        }

        setCurrentPlayingId(videoToPlay.id);
        const ids = parseYouTubeUrl(videoToPlay.url);

        if (!ids || (!ids.videoId && !ids.listId)) {
            setStatus(`Invalid URL: ${videoToPlay.url}. Skipping.`);
            setTimeout(playNextVideo, 2000);
            return;
        }

        setStatus(`Loading: ${videoToPlay.url}`);
        if (ids.listId) {
            player.loadPlaylist({ list: ids.listId, listType: 'playlist', index: 0, suggestedQuality: 'large' });
        } else if (ids.videoId) {
            player.loadVideoById(ids.videoId);
        }
    };

    const isWithinSchedule = useCallback(() => {
        if (!scheduleEnabled) return true;
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        for (const item of schedule) {
            if (item.startTime && item.stopTime) {
                const [startH, startM] = item.startTime.split(':').map(Number);
                const [stopH, stopM] = item.stopTime.split(':').map(Number);
                const startTime = startH * 60 + startM;
                const stopTime = stopH * 60 + stopM;
                if (startTime <= stopTime) {
                    if (currentTime >= startTime && currentTime < stopTime) return true;
                } else {
                    if (currentTime >= startTime || currentTime < stopTime) return true;
                }
            }
        }
        return false;
    }, [schedule, scheduleEnabled]);
    
    const handleStart = () => {
        if (!isWithinSchedule()) {
            setStatus('Outside of scheduled time. Waiting...');
            if (!scheduleIntervalRef.current) scheduleIntervalRef.current = setInterval(handleStart, 60000);
            return;
        }
        if (scheduleIntervalRef.current) {
            clearInterval(scheduleIntervalRef.current);
            scheduleIntervalRef.current = null;
        }
        currentVideoIndexRef.current = 0;
        loopCountRef.current = 0;
        setIsPlaying(true);
        playVideo();
        if (scheduleEnabled) {
            scheduleIntervalRef.current = setInterval(() => {
                if (!isWithinSchedule()) stopPlayback('Scheduled stop time reached.');
            }, 30000);
        }
    };
    
    useEffect(() => {
        window.onYouTubeIframeAPIReady = () => setIsApiReady(true);
        if (window.YT && window.YT.Player) setIsApiReady(true);
    }, []);

    useEffect(() => {
        if (!isApiReady) return;

        videos.forEach(video => {
            if (!playersRef.current[video.id] && document.getElementById(`player-${video.id}`)) {
                playersRef.current[video.id] = new window.YT.Player(`player-${video.id}`, {
                    height: '100%',
                    width: '100%',
                    playerVars: { 'playsinline': 1, 'controls': 1, 'rel': 0, 'modestbranding': 1 },
                    events: {
                        'onReady': (event) => onPlayerReady(event, video.id),
                        'onStateChange': onPlayerStateChange,
                        'onError': onPlayerError
                    }
                });
                playerReadyStatusRef.current[video.id] = false;
            }
        });

        const currentVideoIds = new Set(videos.map(v => v.id));
        Object.keys(playersRef.current).forEach(playerId => {
            if (!currentVideoIds.has(Number(playerId))) {
                playersRef.current[playerId]?.destroy();
                delete playersRef.current[playerId];
                delete playerReadyStatusRef.current[playerId];
            }
        });

    }, [videos, isApiReady, onPlayerStateChange, onPlayerError, onPlayerReady]);
    
    return (
        <>
            <div id="video-list-container" className="container">
                {videos.map((video) => (
                    <div key={video.id} className={`video-item ${currentPlayingId === video.id ? 'playing' : ''}`}>
                        <div className="video-player-wrapper">
                           <div id={`player-${video.id}`}></div>
                        </div>

                        <div className="video-item-main">
                            <div className="url-input-group">
                                <label htmlFor={`url-${video.id}`}>YouTube Video or Playlist URL</label>
                                <input
                                    id={`url-${video.id}`} type="text" value={video.url}
                                    placeholder="https://www.youtube.com/watch?v=..."
                                    onChange={(e) => updateVideo(video.id, 'url', e.target.value)}
                                    disabled={isPlaying}
                                />
                            </div>
                            <div className="controls-group">
                                <div className="control">
                                    <label htmlFor={`loop-${video.id}`}>Loop (0 for ∞)</label>
                                    <input
                                        id={`loop-${video.id}`} type="number" min="0" value={video.loop}
                                        onChange={(e) => updateVideo(video.id, 'loop', parseInt(e.target.value, 10) || 0)}
                                        disabled={isPlaying}
                                    />
                                </div>
                                <div className="control">
                                    <label htmlFor={`delay-${video.id}`}>Delay (s)</label>
                                    <input
                                        id={`delay-${video.id}`} type="number" min="0" value={video.delay}
                                        onChange={(e) => updateVideo(video.id, 'delay', parseInt(e.target.value, 10) || 0)}
                                        disabled={isPlaying}
                                    />
                                </div>
                            </div>
                        </div>
                        <button className="remove-btn" onClick={() => removeVideo(video.id)} disabled={isPlaying}>×</button>
                    </div>
                ))}
            </div>

            <button className="add-btn" onClick={addVideo} disabled={isPlaying}>+ Add Video/Playlist</button>

            <div id="schedule-container" className="container">
                <div className="schedule-header">
                    <h2>Schedule <span>(Optional)</span></h2>
                    <div className="toggle-switch">
                        Enable
                        <label className="switch">
                            <input type="checkbox" checked={scheduleEnabled} onChange={() => setScheduleEnabled(!scheduleEnabled)} disabled={isPlaying} />
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>
                <div className={`schedule-grid ${!scheduleEnabled || isPlaying ? 'disabled' : ''}`}>
                    {schedule.map(item => (
                         <React.Fragment key={item.id}>
                            <div>
                               <label htmlFor={`start-${item.id}`}>Start Time</label>
                               <input type="time" id={`start-${item.id}`} value={item.startTime} onChange={e => updateSchedule(item.id, 'startTime', e.target.value)} disabled={!scheduleEnabled || isPlaying} />
                           </div>
                           <div>
                               <label htmlFor={`stop-${item.id}`}>Stop Time</label>
                               <input type="time" id={`stop-${item.id}`} value={item.stopTime} onChange={e => updateSchedule(item.id, 'stopTime', e.target.value)} disabled={!scheduleEnabled || isPlaying} />
                           </div>
                         </React.Fragment>
                    ))}
                </div>
            </div>
            
            <div className="status-bar">{status}</div>

            <div className="main-controls">
                <button className="main-btn start-btn" onClick={handleStart} disabled={isPlaying || videos.every(v => !v.url)}>Start</button>
                <button className="main-btn stop-btn" onClick={() => stopPlayback()} disabled={!isPlaying}>Stop</button>
            </div>
        </>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}