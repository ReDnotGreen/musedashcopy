// --- THE ADVANCED ACOUSTIC AUTO-MAPPER (RE-CALIBRATED) ---

function analyzeAudioAndGenerateNotes(audioBuffer) {
    const channelData = audioBuffer.getChannelData(0); 
    const sampleRate = audioBuffer.sampleRate;
    
    let generatedNotes = [];
    let lastNoteTime = -10; 

    console.log("Analyzing audio waveforms...");

    // --- STEP 1: FIND ABSOLUTE PEAK ---
    let maxPeak = 0;
    for (let i = 0; i < channelData.length; i += 100) {
        let absValue = Math.abs(channelData[i]);
        if (absValue > maxPeak) maxPeak = absValue;
    }
    console.log(`Loudest peak found at: ${maxPeak}`);

    // TWEAK 1: Raised from 0.45 to 0.55. 
    // This cuts out background noise and weak beats, significantly reducing overall note spam.
    const BASE_THRESHOLD = maxPeak * 0.55; 
    
    // TWEAK 2: Raised from 0.15 to 0.20.
    // Forces a slightly longer gap between individual notes.
    const MIN_COOLDOWN = 0.20; 

    // --- STEP 2: SHAPE & INTENSITY SCAN ---
    for (let i = 0; i < channelData.length; i += 500) { 
        let val = Math.abs(channelData[i]);
        let currentTime = i / sampleRate;

        if (val > BASE_THRESHOLD && (currentTime - lastNoteTime > MIN_COOLDOWN)) {
            
            let intensity = val / maxPeak; 
            
            // LOOKAHEAD: Scan the next 0.5 seconds
            let samplesToLook = sampleRate * 0.5;
            let sum = 0;
            let lookCount = 0;
            let maxLook = Math.min(i + samplesToLook, channelData.length);
            
            for (let j = i; j < maxLook; j += 500) {
                sum += Math.abs(channelData[j]);
                lookCount++;
            }
            
            let sustainAvg = sum / lookCount;
            let sustainRatio = sustainAvg / maxPeak; 
            
            // --- DECISION TREE ---
            let noteType = 'short';
            let duration = undefined;
            let lane = Math.random() > 0.5 ? 'top' : 'bottom';
            let cooldownToApply = MIN_COOLDOWN;

            // 1. Sustained Sound
            if (sustainRatio > 0.35) { 
                if (intensity > 0.8) {
                    noteType = 'mash';
                    duration = 1.0; 
                    lane = 'both';
                } else {
                    noteType = 'long';
                    duration = 0.5; 
                }
                cooldownToApply = duration + 0.25; 
            } 
            // 2. Sharp Hit
            else { 
                let timeSinceLastBeat = currentTime - lastNoteTime;

                if (intensity > 0.95) { // Made stricter (was 0.92)
                    noteType = 'sync'; 
                    lane = 'both';
                } else if (intensity > 0.88) { // Made stricter (was 0.85)
                    noteType = 'emp'; 
                } else if (timeSinceLastBeat < 0.25 && timeSinceLastBeat > 0) {
                    noteType = 'glitch'; 
                } else if (intensity < 0.65) { 
                    // TWEAK 3: Only a 30% chance to be a ghost note. 
                    // The other 70% of the time, quiet beats stay as standard 'short' notes.
                    if (Math.random() > 0.70) {
                        noteType = 'ghost';
                    } else {
                        noteType = 'short';
                    }
                } else if (Math.random() > 0.95) {
                    noteType = 'hazard'; 
                }
            }

            // --- CREATE THE NOTE ---
            let newNote = {
                time: parseFloat(currentTime.toFixed(2)),
                lane: lane,
                type: noteType
            };

            if (duration) newNote.duration = duration;
            if (noteType === 'mash') {
                newNote.goodHits = Math.max(2, Math.floor(duration * 8));
                newNote.perfectHits = Math.max(3, Math.floor(duration * 15));
            }

            generatedNotes.push(newNote);
            lastNoteTime = currentTime;
            
            i += Math.floor(cooldownToApply * sampleRate); 
        }
    }

    console.log(`Auto-Mapper finished! Generated ${generatedNotes.length} highly-analyzed notes.`);
    return generatedNotes;
}