const playPauseBtn = document.getElementById('playPauseBtn');
const importBtn = document.getElementById('importBtn');
const exportBtn = document.getElementById('exportBtn');
const trackInput = document.getElementById('trackInput'); // NEW
const loadTrackBtn = document.getElementById('loadTrackBtn'); // NEW


const jsonOutput = document.getElementById('jsonOutput');
const timeline = document.getElementById('timeline');
const playhead = document.getElementById('playhead');
const laneTop = document.getElementById('lane-top');
const laneBottom = document.getElementById('lane-bottom');

const localAudioUpload = document.getElementById('localAudioUpload');
const autoMapBtn = document.getElementById('autoMapBtn');


let audioContext;
let audioBuffer;
let audioSource;
let startTime = 0;
let isPlaying = false;
let pauseTime = 0; // Remembers where we paused

// Editor Configuration
const PIXELS_PER_SECOND = 200; // Zoom level: 1 second = 200px
const SNAP_INTERVAL = 0.05;    // Snap to 50ms grid intervals

// The master array of notes
let beatmapNotes = [];
let noteIdCounter = 0; 

// Drag State
let draggedNoteElement = null;
let dragStartX = 0;
let initialNoteLeft = 0;

// Resize State
let resizingNoteId = null;
let resizeStartX = 0;
let initialDuration = 0;
let maxResizeDuration = Infinity; // NEW: Caps how far we can stretch

// --- UPDATED: COLLISION DETECTION ---
function checkOverlap(newTime, lane, type, ignoreId = -1) {
    // Standard notes visually take up 0.1s of space. Long/Mash take 1.0s by default.
    let duration = (type === 'long' || type === 'mash') ? 1.0 : 0.1; 
    let start1 = newTime;
    let end1 = newTime + duration;

    // A tiny buffer to forgive microscopic floating-point math overlaps
    const EPSILON = 0.01; 

    for (let note of beatmapNotes) {
        if (note.id === ignoreId) continue; // Don't check against itself
        
        // Check if lanes intersect
        let laneConflict = (note.lane === lane) || (note.lane === 'both') || (lane === 'both');
        if (!laneConflict) continue;

        let noteDuration = (note.type === 'long' || note.type === 'mash') ? note.duration : 0.1;
        let start2 = note.time;
        let end2 = note.time + noteDuration;

        // Strict overlap math WITH the epsilon buffer
        if (start1 < end2 - EPSILON && start2 < end1 - EPSILON) {
            return true; // Collision detected!
        }
    }
    return false; // Safe to place
}

// --- AUDIO SYSTEM ---
async function loadAudio() {
    try {
        const trackName = trackInput.value.trim() || 'track.mp3';
        
        // Stop current audio if we are loading a new one
        if (isPlaying && audioSource) {
            audioSource.stop();
            isPlaying = false;
            playPauseBtn.innerText = "PLAY";
            playPauseBtn.style.color = "#39ff14";
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const response = await fetch(trackName); 
        
        if (!response.ok) throw new Error("File not found");

        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Resize timeline to fit new song length
        timeline.style.width = `${audioBuffer.duration * PIXELS_PER_SECOND}px`;
        
    } catch(error) {
        alert(`Error loading audio file '${trackInput.value}'. Make sure the file exists in the game!`);
    }
}

// Connect the manual load button
loadTrackBtn.addEventListener('click', () => {
    pauseTime = 0; // Reset playhead
    playhead.style.left = "0px";
    loadAudio();
});

playPauseBtn.addEventListener('click', async () => {
    if (!audioContext) await loadAudio();
    
    if (isPlaying) {
        audioSource.stop();
        pauseTime = audioContext.currentTime - startTime;
        isPlaying = false;
        playPauseBtn.innerText = "PLAY AUDIO";
        playPauseBtn.style.color = "#39ff14";
        playPauseBtn.style.borderColor = "#39ff14";
    } else {
        audioSource = audioContext.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.connect(audioContext.destination);
        
        startTime = audioContext.currentTime - pauseTime;
        audioSource.start(0, pauseTime);
        isPlaying = true;
        playPauseBtn.innerText = "PAUSE AUDIO";
        playPauseBtn.style.color = "red";
        playPauseBtn.style.borderColor = "red";
        
        requestAnimationFrame(updatePlayhead);
    }
});

function updatePlayhead() {
    if (!isPlaying) return;
    const currentTime = audioContext.currentTime - startTime;
    playhead.style.left = `${currentTime * PIXELS_PER_SECOND}px`;
    
    // Auto-scroll the timeline wrapper to keep playhead in view
    const wrapper = document.getElementById('timelineWrapper');
    if (currentTime * PIXELS_PER_SECOND > wrapper.scrollLeft + wrapper.clientWidth * 0.8) {
        wrapper.scrollLeft = (currentTime * PIXELS_PER_SECOND) - wrapper.clientWidth * 0.2;
    }

    if (currentTime < audioBuffer.duration) {
        requestAnimationFrame(updatePlayhead);
    } else {
        isPlaying = false;
        playPauseBtn.innerText = "PLAY AUDIO";
    }
}

// --- VISUAL NOTE SPAWNING ---
// Clicking anywhere on the timeline moves the playhead (if paused)
timeline.addEventListener('mousedown', (e) => {
    if (isPlaying || e.target.classList.contains('ui-note')) return;
    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    pauseTime = clickX / PIXELS_PER_SECOND;
    playhead.style.left = `${clickX}px`;
});

// Sidebar Buttons spawn notes at the Playhead
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        let type = btn.getAttribute('data-type');
        let lane = btn.getAttribute('data-lane');
        
        // Use the current playhead position, snapped to grid
        let spawnTime = Math.round(pauseTime / SNAP_INTERVAL) * SNAP_INTERVAL;

        // --- NEW: Block Spawning if Overlapping ---
        if (checkOverlap(spawnTime, lane, type)) {
            let originalText = btn.innerText;
            btn.innerText = "LANE BLOCKED!";
            btn.style.color = "red";
            btn.style.borderColor = "red";
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.color = "#ccc";
                btn.style.borderColor = "#555";
            }, 1000);
            return; // Stop the code here so the note isn't created
        }

        let baseDuration = (type === 'long' || type === 'mash') ? 1.0 : undefined;
        
        let newNote = {
            id: noteIdCounter++,
            time: spawnTime,
            lane: lane,
            type: type,
            duration: baseDuration,
            // Calculate hits based on the default 1.0s duration (6 hits/sec for Good, 12 hits/sec for Perfect)
            goodHits: type === 'mash' ? Math.max(2, Math.floor(baseDuration * 6)) : undefined,
            perfectHits: type === 'mash' ? Math.max(3, Math.floor(baseDuration * 12)) : undefined
        };

        beatmapNotes.push(newNote);
        renderNotes();
    });
});

// --- DRAG AND DROP ENGINE ---
function renderNotes() {
    // Clear existing DOM notes
    document.querySelectorAll('.ui-note').forEach(n => n.remove());

    beatmapNotes.forEach(note => {
        let div = document.createElement('div');
        div.className = `ui-note bg-${note.type} lane-${note.lane}`;
        div.dataset.id = note.id;
        
        // Position it based on time
        div.style.left = `${note.time * PIXELS_PER_SECOND}px`;
        
        // --- NEW: Dynamic Width & Handles for Sustained Notes ---
        if (note.type === 'long' || note.type === 'mash') {
            div.style.width = `${note.duration * PIXELS_PER_SECOND}px`;
            div.style.justifyContent = 'flex-start'; 
            div.style.paddingLeft = '5px';
            
            let handle = document.createElement('div');
            handle.className = 'resize-handle';
            // Start resizing on click
            handle.addEventListener('mousedown', (e) => onResizeMouseDown(e, note.id));
            div.appendChild(handle);
        }

        // Visual text
        let labelSpan = document.createElement('span');
        let label = note.type.substring(0, 3).toUpperCase();
        if (note.type === 'hazard') label = 'X';
        if (note.type === 'emp') label = '⚡';
        labelSpan.innerText = label;
        labelSpan.style.pointerEvents = 'none'; // Prevents text from interfering with drag
        div.appendChild(labelSpan);

        // Make it draggable
        div.addEventListener('mousedown', onNoteMouseDown);
        
        // Right click to delete
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            beatmapNotes = beatmapNotes.filter(n => n.id !== note.id);
            renderNotes();
        });

        // Append to correct lane (or top lane if 'both')
        if (note.lane === 'bottom') {
            laneBottom.appendChild(div);
        } else {
            laneTop.appendChild(div);
        }
    });
}

function onNoteMouseDown(e) {
    if (isPlaying) return;
    draggedNoteElement = e.target;
    dragStartX = e.clientX;
    initialNoteLeft = parseFloat(draggedNoteElement.style.left || 0);
    
    document.addEventListener('mousemove', onNoteMouseMove);
    document.addEventListener('mouseup', onNoteMouseUp);
}

function onNoteMouseMove(e) {
    if (!draggedNoteElement) return;
    
    // Calculate new pixel position
    const deltaX = e.clientX - dragStartX;
    let newLeft = initialNoteLeft + deltaX;
    
    // Prevent dragging off the left edge
    if (newLeft < 0) newLeft = 0;
    
    // Apply Snapping (Convert pixels -> time -> snapped time -> snapped pixels)
    let rawTime = newLeft / PIXELS_PER_SECOND;
    let snappedTime = Math.round(rawTime / SNAP_INTERVAL) * SNAP_INTERVAL;
    
    draggedNoteElement.style.left = `${snappedTime * PIXELS_PER_SECOND}px`;
}

function onNoteMouseUp(e) {
    if (!draggedNoteElement) return;
    
    const noteId = parseInt(draggedNoteElement.dataset.id);
    const finalLeft = parseFloat(draggedNoteElement.style.left);
    const newTime = finalLeft / PIXELS_PER_SECOND;
    
    const noteData = beatmapNotes.find(n => n.id === noteId);
    if (noteData) {
        let snappedTime = parseFloat(newTime.toFixed(2));
        
        // --- NEW: Reject drop if overlapping ---
        if (checkOverlap(snappedTime, noteData.lane, noteData.type, noteId)) {
            // Flash it red to warn the user, then re-render to snap it back to its old safe time
            draggedNoteElement.style.backgroundColor = "red";
            setTimeout(() => renderNotes(), 200); 
        } else {
            // It's safe! Update the data and render.
            noteData.time = snappedTime;
            renderNotes(); 
        }
    }
    
    // Cleanup listeners
    draggedNoteElement = null;
    document.removeEventListener('mousemove', onNoteMouseMove);
    document.removeEventListener('mouseup', onNoteMouseUp);
}

// --- EXPORT ---
exportBtn.addEventListener('click', () => {
    if (beatmapNotes.length === 0) {
        jsonOutput.value = "Add some notes first!";
        return;
    }

    // Sort notes by time so the game engine reads them correctly
    beatmapNotes.sort((a, b) => a.time - b.time);

    // Clean up the data (remove our internal 'id' before exporting)
    const cleanNotes = beatmapNotes.map(n => {
        const { id, ...rest } = n; 
        return rest;
    });

    const outputObj = {
        songName: "My Custom Beatmap",
        bpm: 120,
        audioFile: trackInput.value.trim() || "track.mp3", // NEW: Saves the audio file name
        notes: cleanNotes
    };

    jsonOutput.value = JSON.stringify(outputObj, null, 2);
    
    // Auto-copy
    jsonOutput.select();
    navigator.clipboard.writeText(jsonOutput.value);
    
    const originalText = exportBtn.innerText;
    exportBtn.innerText = "COPIED TO CLIPBOARD!";
    exportBtn.style.color = "white";
    setTimeout(() => { 
        exportBtn.innerText = originalText; 
        exportBtn.style.color = "#ff00ff";
    }, 2000);
});

// --- NEW: NOTE RESIZING ENGINE ---
function onResizeMouseDown(e, noteId) {
    e.stopPropagation(); 
    if (isPlaying) return;
    
    resizingNoteId = noteId;
    resizeStartX = e.clientX;
    
    const noteData = beatmapNotes.find(n => n.id === noteId);
    initialDuration = noteData.duration;
    
    // --- NEW: Calculate the invisible wall ---
    maxResizeDuration = Infinity;
    const RECOVERY_BUFFER = 0.25; // The gap we require after sustained notes
    
    // Look at all other notes to find the closest one in front of us
    for (let otherNote of beatmapNotes) {
        if (otherNote.id === noteId) continue;
        
        let laneConflict = (otherNote.lane === noteData.lane) || (otherNote.lane === 'both') || (noteData.lane === 'both');
        if (!laneConflict) continue;

        // If the other note comes AFTER the one we are resizing
        if (otherNote.time > noteData.time) {
            // Calculate exact space available between our start time and their start time
            let allowedSpace = (otherNote.time - noteData.time) - RECOVERY_BUFFER;
            if (allowedSpace < maxResizeDuration) {
                maxResizeDuration = allowedSpace;
            }
        }
    }
    
    // Snap the max duration to our grid so it feels clean
    maxResizeDuration = Math.floor(maxResizeDuration / SNAP_INTERVAL) * SNAP_INTERVAL;

    document.addEventListener('mousemove', onResizeMouseMove);
    document.addEventListener('mouseup', onResizeMouseUp);
}

function onResizeMouseMove(e) {
    if (resizingNoteId === null) return;
    
    const deltaX = e.clientX - resizeStartX;
    let newDuration = initialDuration + (deltaX / PIXELS_PER_SECOND);
    
    // Enforce grid snapping
    newDuration = Math.round(newDuration / SNAP_INTERVAL) * SNAP_INTERVAL;
    
    // Prevent notes from becoming too short
    if (newDuration < 0.1) newDuration = 0.1; 
    
    // --- NEW: Stop stretching if we hit the invisible wall ---
    if (newDuration > maxResizeDuration) {
        newDuration = maxResizeDuration;
    }

    // Instantly update the visual width
    const el = document.querySelector(`.ui-note[data-id='${resizingNoteId}']`);
    if (el) {
        el.style.width = `${newDuration * PIXELS_PER_SECOND}px`;
    }
}

function onResizeMouseUp(e) {
    if (resizingNoteId === null) return;
    
    const el = document.querySelector(`.ui-note[data-id='${resizingNoteId}']`);
    if (el) {
        // Calculate the final time and save it permanently
        const finalWidth = parseFloat(el.style.width);
        const finalDuration = finalWidth / PIXELS_PER_SECOND;
        
        const noteData = beatmapNotes.find(n => n.id === resizingNoteId);
        if (noteData) {
            noteData.duration = parseFloat(finalDuration.toFixed(2));
            
            // --- NEW: Recalculate Mash hits when resized ---
            if (noteData.type === 'mash') {
                noteData.goodHits = Math.max(2, Math.floor(noteData.duration * 8));
                noteData.perfectHits = Math.max(3, Math.floor(noteData.duration * 15));
            }
        }
    }

    // Cleanup
    resizingNoteId = null;
    document.removeEventListener('mousemove', onResizeMouseMove);
    document.removeEventListener('mouseup', onResizeMouseUp);
    
    // Re-render to finalize layout and ensure JSON gets updated on export
    renderNotes(); 
}

// --- NEW: IMPORT JSON ---
importBtn.addEventListener('click', async () => {
    // 1. Get the text from the box
    const rawJSON = jsonOutput.value.trim();
    
    if (!rawJSON) {
        alert("Please paste your JSON into the text box first!");
        return;
    }

    try {
        // 2. Try to parse it
        const importedData = JSON.parse(rawJSON);

        // 3. Validate that it's actually a beatmap
        if (!importedData.notes || !Array.isArray(importedData.notes)) {
            alert("Invalid format! Make sure you are pasting a complete track object (with 'songName' and 'notes').");
            return;
        }

        // 4. Wipe the current editor slate clean
        beatmapNotes = [];
        noteIdCounter = 0;

        // --- NEW: Load the track attached to the imported JSON ---
        if (importedData.audioFile) {
            trackInput.value = importedData.audioFile;
            await loadAudio(); // Wait for the new audio to load before rendering
        }

        // 5. Rebuild the notes array, giving them fresh editor IDs
        importedData.notes.forEach(note => {
            beatmapNotes.push({
                ...note,
                id: noteIdCounter++
            });
        });

        // 6. Redraw the visual timeline
        renderNotes();

        // Visual feedback for success
        const originalText = importBtn.innerText;
        importBtn.innerText = "LOADED SUCCESSFULLY!";
        importBtn.style.color = "white";
        importBtn.style.borderColor = "white";
        
        setTimeout(() => { 
            importBtn.innerText = originalText; 
            importBtn.style.color = "#00ffff";
            importBtn.style.borderColor = "#00ffff";
        }, 2000);

    } catch (error) {
        // If they pasted broken code, catch the error so the page doesn't crash
        alert("Syntax Error! The JSON you pasted is broken or incomplete. Check for missing commas or brackets.");
        console.error("Import Error:", error);
    }
});

// --- NEW: LOCAL FILE UPLOAD & AUTO-MAPPING ---

// 1. Clicking the button clicks the hidden file input
autoMapBtn.addEventListener('click', () => {
    localAudioUpload.click(); 
});

// 2. When the user selects an MP3 from their PC
localAudioUpload.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Stop current audio if playing
    if (isPlaying && audioSource) {
        audioSource.stop();
        isPlaying = false;
        playPauseBtn.innerText = "PLAY";
    }

    autoMapBtn.innerText = "ANALYZING...";
    autoMapBtn.disabled = true;

    try {
        // Convert the local file into an ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        
        // Decode it into audio
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Update timeline width
        timeline.style.width = `${audioBuffer.duration * PIXELS_PER_SECOND}px`;
        pauseTime = 0;
        playhead.style.left = "0px";
        
        // Update the input text to show we are using a local file
        trackInput.value = file.name;

        // --- MAGIC HAPPENS HERE ---
        // Wipe the slate clean
        beatmapNotes = [];
        noteIdCounter = 0;

        // Run the Auto-Mapper from autoMapper.js
        const autoGeneratedMap = analyzeAudioAndGenerateNotes(audioBuffer);

        // Apply editor IDs to the new notes
        autoGeneratedMap.forEach(note => {
            beatmapNotes.push({
                ...note,
                id: noteIdCounter++
            });
        });

        // Draw them!
        renderNotes();

        autoMapBtn.innerText = "🪄 AUTO-MAP LOCAL MP3";
        autoMapBtn.disabled = false;

    } catch (error) {
        console.error(error);
        alert("Failed to process the audio file. Make sure it's a valid MP3 or WAV.");
        autoMapBtn.innerText = "🪄 AUTO-MAP LOCAL MP3";
        autoMapBtn.disabled = false;
    }
});

loadAudio();