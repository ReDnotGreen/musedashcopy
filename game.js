const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const practiceBtn = document.getElementById('practiceBtn');
const mainUI = document.getElementById('mainUI');

const endScreen = document.getElementById('endScreen');
const finalScoreText = document.getElementById('finalScoreText');
const emojiGrid = document.getElementById('emojiGrid');
const shareBtn = document.getElementById('shareBtn');
const menuBtn = document.getElementById('menuBtn');

const howToPlayBtn = document.getElementById('howToPlayBtn');
const howToPlayModal = document.getElementById('howToPlayModal');
const closeInstructionsBtn = document.getElementById('closeInstructionsBtn');

const practiceModal = document.getElementById('practiceModal');
const closePracticeBtn = document.getElementById('closePracticeBtn');
const levelList = document.getElementById('levelList');

let audioContext;
let audioBuffer;
let audioSource;
let startTime = 0;
let isPlaying = false;
let gameOver = false;

let allLevelsData = [];
let isPracticeMode = false;

let score = 0;
let combo = 0;
let health = 100;
let feedbackText = "";
let beatmap = [];
let songDetails = {};
const keys = { top: false, bottom: false };
const hitZoneX = 100; 
const scrollSpeed = 400; 
const topLaneY = 100;
const bottomLaneY = 250;
const PERFECT_WINDOW = 0.08; 
const GOOD_WINDOW = 0.15;    
let topFlashTimer = 0;
let bottomFlashTimer = 0;

let empFlashAlpha = 0;

const GAME_EPOCH = new Date("2026-04-01T00:00:00").getTime(); 
let dayIndex = 0;
let todayString = "";

async function initGame() {
    const levelResponse = await fetch('levels.json');
    allLevelsData = await levelResponse.json();
    
    allLevelsData.forEach((level, index) => {
        const btn = document.createElement('button');
        btn.className = 'practice-track-btn';
        btn.innerText = `Track ${index + 1}: ${level.songName}`;
        btn.onclick = () => startRun(true, index);
        levelList.appendChild(btn);
    });
    checkDailyStatus();
}

function checkDailyStatus() {
    const now = new Date();
    todayString = now.toDateString(); 
    dayIndex = Math.floor((now.getTime() - GAME_EPOCH) / (1000 * 60 * 60 * 24));
    const lastPlayedDate = localStorage.getItem('neonRun_date');
    if (lastPlayedDate === todayString) {
        startBtn.innerText = "ALREADY PLAYED"; startBtn.disabled = true;
    }
}

howToPlayBtn.onclick = () => { howToPlayModal.style.display = 'block'; };
closeInstructionsBtn.onclick = () => { howToPlayModal.style.display = 'none'; };
practiceBtn.onclick = () => { practiceModal.style.display = 'block'; };
closePracticeBtn.onclick = () => { practiceModal.style.display = 'none'; };
startBtn.onclick = () => { startRun(false, dayIndex % allLevelsData.length); };
menuBtn.onclick = () => { resetToMainMenu(); };

window.onclick = (event) => {
    if (event.target == howToPlayModal) howToPlayModal.style.display = 'none'; 
    if (event.target == practiceModal) practiceModal.style.display = 'none'; 
    if (event.target == endScreen) endScreen.style.display = 'none'; 
}

let particles = [];
class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.speedX = (Math.random() - 0.5) * 8; this.speedY = (Math.random() - 0.5) * 8;
        this.radius = Math.random() * 3 + 1; this.life = 1.0; this.decay = Math.random() * 0.05 + 0.02;
    }
    draw() { ctx.globalAlpha = this.life; ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1.0; }
    update() { this.x += this.speedX; this.y += this.speedY; this.life -= this.decay; this.radius = Math.max(0, this.radius - 0.05); }
}
function createParticleExplosion(x, y, color, count) { for (let i = 0; i < count; i++) { particles.push(new Particle(x, y, color)); } }
function updateAndDrawParticles() { particles = particles.filter(p => p.life > 0); particles.forEach(p => { p.update(); p.draw(); }); }

async function startRun(isPractice, mapIndex) {
    isPracticeMode = isPractice;
    mainUI.style.display = 'none'; practiceModal.style.display = 'none';
    
    songDetails = allLevelsData[mapIndex];
    
    // --- UPDATED: Note Mapping now includes goodHits and perfectHits defaults ---
    beatmap = songDetails.notes.map(note => ({
        ...note, type: note.type || 'short', duration: note.duration || 0,
        hit: false, missed: false, active: false, grade: '', mashCount: 0,
        goodHits: note.goodHits || 8, perfectHits: note.perfectHits || 15 
    }));

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const response = await fetch('track.mp3'); 
    const buffer = await response.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(buffer);

    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer; audioSource.connect(audioContext.destination);
    startTime = audioContext.currentTime; audioSource.start();
    isPlaying = true; gameOver = false; empFlashAlpha = 0;
    
    requestAnimationFrame(gameLoop);
}

window.addEventListener('keydown', (e) => {
    if (!isPlaying || gameOver) return;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault(); 
    if (e.code === 'ArrowUp' && !keys.top) { keys.top = true; topFlashTimer = 10; checkHit('top');
    } else if (e.code === 'ArrowDown' && !keys.bottom) { keys.bottom = true; bottomFlashTimer = 10; checkHit('bottom'); }
});
window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowUp') keys.top = false;
    if (e.code === 'ArrowDown') keys.bottom = false;
});

function checkHit(targetLane) {
    const currentTime = audioContext.currentTime - startTime;
    const hitZoneY = targetLane === 'top' ? topLaneY + 25 : bottomLaneY + 25; 
    
    for (let i = 0; i < beatmap.length; i++) {
        let note = beatmap[i];
        if (note.hit || note.missed || note.active) continue; 
        if (note.lane !== targetLane && note.lane !== 'both') continue; 
        
        let targetEndTime = note.time + note.duration;
        let timeDiff = Math.abs(note.time - currentTime);

        // --- UPDATED: MASH LOGIC (Scores every hit) ---
        if (note.type === 'mash') {
            if (currentTime >= note.time - GOOD_WINDOW && currentTime <= targetEndTime) {
                score += 10; // Small points per tap
                note.mashCount++;
                createParticleExplosion(hitZoneX + 25, hitZoneY, "#ffaa00", 8); 
                return; 
            }
            continue; 
        }

        if (note.time - currentTime > GOOD_WINDOW) continue; 

        if (timeDiff <= PERFECT_WINDOW || timeDiff <= GOOD_WINDOW) {
            if (note.type === 'sync') {
                if (keys.top && keys.bottom) {
                    note.hit = true; score += 200; combo++; health = Math.min(100, health + 4);
                    feedbackText = "SYNC PERFECT!"; note.grade = '🟩';
                    createParticleExplosion(hitZoneX + 25, topLaneY + 25, "#00ffff", 15);
                    createParticleExplosion(hitZoneX + 25, bottomLaneY + 25, "#00ffff", 15);
                    break;
                } else { continue; }
            }

            if (note.type === 'emp') {
                note.hit = true; score = Math.max(0, score - 100); health -= 30; combo = 0; 
                feedbackText = "EMP DETONATED!"; note.grade = '💥';
                empFlashAlpha = 1.0; 
                createParticleExplosion(hitZoneX + 25, hitZoneY, "white", 40); 
                break;
            }

            if (note.type === 'hazard') {
                note.hit = true; score = Math.max(0, score - 50); health -= 20; combo = 0; feedbackText = "SYSTEM DMG!"; note.grade = '💥';
                createParticleExplosion(hitZoneX + 25, hitZoneY, "red", 20); break;
            }

            let isPerfect = timeDiff <= PERFECT_WINDOW;
            score += isPerfect ? 100 : 50;
            if (isPerfect) health = Math.min(100, health + 2);
            feedbackText = isPerfect ? "PERFECT" : "GOOD";
            const color = isPerfect ? "#00ffff" : "#ff00ff";
            createParticleExplosion(hitZoneX + 25, hitZoneY, color, 15);

            if (note.type === 'short' || note.type === 'ghost' || note.type === 'glitch') {
                combo++; note.hit = true; note.grade = isPerfect ? '🟩' : '🟨';
            } else if (note.type === 'long') { note.active = true; }
            break; 
        }
    }
}

function gameLoop() {
    if (!isPlaying) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const currentTime = audioContext.currentTime - startTime;

    if (health <= 0) { endGame(false); return; }
    const lastNote = beatmap[beatmap.length - 1];
    const lastTime = lastNote.time + lastNote.duration;
    if (currentTime > lastTime + 2) { endGame(true); return; }

    updateAndDrawParticles(); 

    ctx.font = "20px 'Orbitron', sans-serif";
    ctx.fillStyle = "#00ffff"; 
    let titlePrefix = isPracticeMode ? "PRACTICE" : `DAY ${dayIndex}`;
    ctx.fillText(`${titlePrefix}: ${songDetails.songName || "UNKNOWN"}`, 20, 30);
    ctx.fillText(`SCORE: ${score}`, 20, 60);
    ctx.fillStyle = combo > 10 ? "#ff00ff" : "white"; 
    ctx.fillText(`COMBO: ${combo}`, 20, 90);
    ctx.fillStyle = "#39ff14"; 
    ctx.fillText(feedbackText, hitZoneX - 25, 160);

    ctx.fillStyle = "white"; ctx.fillText("HP:", canvas.width - 170, 30);
    ctx.strokeStyle = "white"; ctx.strokeRect(canvas.width - 130, 15, 100, 15);
    ctx.fillStyle = health > 30 ? "#39ff14" : "red"; ctx.fillRect(canvas.width - 130, 15, health, 15);

    ctx.lineWidth = 3;
    ctx.strokeStyle = topFlashTimer > 0 ? "white" : "#00ffff"; ctx.strokeRect(hitZoneX, topLaneY, 50, 50);
    if (topFlashTimer > 0) { ctx.fillStyle = "rgba(0, 255, 255, 0.3)"; ctx.fillRect(hitZoneX, topLaneY, 50, 50); topFlashTimer--; }
    ctx.strokeStyle = bottomFlashTimer > 0 ? "white" : "#00ffff"; ctx.strokeRect(hitZoneX, bottomLaneY, 50, 50);
    if (bottomFlashTimer > 0) { ctx.fillStyle = "rgba(0, 255, 255, 0.3)"; ctx.fillRect(hitZoneX, bottomLaneY, 50, 50); bottomFlashTimer--; }

    beatmap.forEach(note => {
        if (note.hit) return; 
        let targetEndTime = note.time + note.duration;

        if (note.active && note.type === 'long') {
            const noteCenterY = note.lane === 'top' ? topLaneY + 25 : bottomLaneY + 25;
            if (!keys[note.lane]) {
                let releaseDiff = Math.abs(targetEndTime - currentTime);
                if (releaseDiff <= PERFECT_WINDOW) {
                    note.active = false; note.hit = true; score += 150; combo++; feedbackText = "PERFECT!"; note.grade = '🟩'; health = Math.min(100, health + 2);
                    createParticleExplosion(hitZoneX + 25, noteCenterY, "#00ffff", 20); 
                } else if (releaseDiff <= GOOD_WINDOW) {
                    note.active = false; note.hit = true; score += 100; combo++; feedbackText = "GOOD!"; note.grade = '🟨';
                    createParticleExplosion(hitZoneX + 25, noteCenterY, "#ff00ff", 10); 
                } else {
                    note.active = false; note.missed = true; combo = 0; health -= 10; feedbackText = "DROPPED!"; note.grade = '🟥';
                    createParticleExplosion(hitZoneX + 25, noteCenterY, "gray", 10);
                }
            } else if (currentTime > targetEndTime + GOOD_WINDOW) { note.active = false; note.missed = true; combo = 0; health -= 10; feedbackText = "OVERLOAD!"; note.grade = '🟥'; }
        }

        // --- UPDATED: MASH END LOGIC (Good vs Perfect checks) ---
        if (note.type === 'mash') {
            if (!note.hit && !note.missed && currentTime > targetEndTime) {
                note.hit = true;
                if (note.mashCount >= note.perfectHits) {
                    feedbackText = "PERFECT OVERLOAD!"; note.grade = '🟩'; combo++; score += 300; health = Math.min(100, health + 5);
                } else if (note.mashCount >= note.goodHits) {
                    feedbackText = "GOOD OVERLOAD!"; note.grade = '🟨'; combo++; score += 100;
                } else {
                    feedbackText = "WEAK MASH!"; note.grade = '🟥'; combo = 0; health -= 20;
                }
            }
        }

        if ((note.type === 'hazard' || note.type === 'emp') && !note.hit && !note.missed && currentTime - note.time > GOOD_WINDOW) {
            note.missed = true; score += 50; feedbackText = "EVADED!"; note.grade = '⬜'; 
        } 
        else if (note.type !== 'hazard' && note.type !== 'emp' && note.type !== 'mash' && !note.hit && !note.missed && !note.active && currentTime - note.time > GOOD_WINDOW) {
            note.missed = true; combo = 0; health -= 10; feedbackText = "MISS!"; note.grade = '🟥'; 
        }

        const headX = hitZoneX + ((note.time - currentTime) * scrollSpeed);
        const tailX = hitZoneX + (targetEndTime - currentTime) * scrollSpeed;
        
        let drawLane = note.lane;
        if (note.type === 'glitch' && note.time - currentTime > 0.6) {
            drawLane = note.lane === 'top' ? 'bottom' : 'top';
        }
        const enemyY = drawLane === 'top' ? topLaneY : bottomLaneY;

        if (note.type === 'sync' && headX > -50 && headX < canvas.width + 50) {
            ctx.strokeStyle = note.missed ? "#333" : "#00ffff";
            ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(headX + 25, topLaneY + 25); ctx.lineTo(headX + 25, bottomLaneY + 25); ctx.stroke();
            ctx.fillStyle = note.missed ? "#333" : "#ff00ff"; ctx.fillRect(headX, topLaneY, 50, 50); ctx.fillRect(headX, bottomLaneY, 50, 50); 
        }

        // --- UPDATED: MASH RENDER VISUALS ---
        if (note.type === 'mash') {
            let width = tailX - headX;
            if (tailX > -50 && headX < canvas.width + 50 && width > 0) { 
                ctx.fillStyle = note.missed ? "#333" : "#ffaa00"; 
                
                // Draw a massive block spanning BOTH lanes
                let mashHeight = (bottomLaneY - topLaneY) + 50; 
                ctx.globalAlpha = 0.8;
                ctx.fillRect(headX, topLaneY, width, mashHeight);
                ctx.globalAlpha = 1.0;

                // Lock the text to the hit zone if the block is currently passing through it!
                let textDrawX = Math.max(headX + 10, hitZoneX + 10);
                
                // Change text color if they reach the Good or Perfect thresholds
                if (note.mashCount >= note.perfectHits) ctx.fillStyle = "#39ff14"; // Green for perfect
                else if (note.mashCount >= note.goodHits) ctx.fillStyle = "white"; // White for good
                else ctx.fillStyle = "black"; // Black while struggling
                
                ctx.font = "bold 24px 'Orbitron', sans-serif"; 
                ctx.fillText("MASH!", textDrawX, topLaneY + 50);
                
                // Draw the live tracker
                ctx.font = "bold 20px 'Orbitron', sans-serif";
                ctx.fillText(`${note.mashCount} / ${note.perfectHits}`, textDrawX, topLaneY + 80);
            }
        }

        if (note.type === 'long') {
            ctx.fillStyle = note.missed ? "#333" : (note.active ? "#ff00ff" : "#aa00aa");
            let startDrawX = note.active ? hitZoneX : headX; 
            let width = tailX - startDrawX;
            if (tailX > -50 && startDrawX < canvas.width + 50 && width > 0) { ctx.globalAlpha = 0.6; ctx.fillRect(startDrawX, enemyY + 15, width, 20); ctx.globalAlpha = 1.0; }
            if (tailX > -50 && tailX < canvas.width + 50) { ctx.fillStyle = note.active ? "white" : (note.missed ? "#333" : "#ff00ff"); ctx.fillRect(tailX, enemyY, 50, 50); }
        }

        if (note.type !== 'sync' && note.type !== 'mash' && !note.active && headX > -50 && headX < canvas.width + 50) {
            if (note.type === 'ghost') {
                let distance = headX - hitZoneX; ctx.globalAlpha = Math.min(1, Math.max(0, 1 - (distance / 300))); 
                ctx.fillStyle = note.missed ? "#333" : "white"; ctx.fillRect(headX, enemyY, 50, 50); ctx.globalAlpha = 1.0; 
            } 
            else if (note.type === 'hazard') { 
                ctx.fillStyle = note.missed ? "#333" : "#ff0000"; ctx.fillRect(headX, enemyY, 50, 50); 
                ctx.fillStyle = "black"; ctx.font = "bold 30px Orbitron"; ctx.fillText("X", headX + 13, enemyY + 36); 
            }
            else if (note.type === 'emp') { 
                ctx.fillStyle = note.missed ? "#333" : "white"; ctx.fillRect(headX, enemyY, 50, 50); 
                ctx.fillStyle = "black"; ctx.font = "bold 30px Orbitron"; ctx.fillText("⚡", headX + 10, enemyY + 36); 
            }
            else { 
                ctx.fillStyle = note.missed ? "#333" : (note.type === 'glitch' ? "#00ffff" : "#ff00ff"); 
                ctx.fillRect(headX, enemyY, 50, 50); 
            }
        }
    });

    if (empFlashAlpha > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${empFlashAlpha})`; ctx.fillRect(0, 0, canvas.width, canvas.height); empFlashAlpha -= 0.03; 
    }

    requestAnimationFrame(gameLoop);
}

const emojiDescriptions = { '🟩': 'Perfect Hit', '🟨': 'Good Hit', '🟥': 'Miss or Drop', '⬜': 'Hazard Evaded', '💥': 'System Integrity Failure' };

function endGame(cleared) {
    gameOver = true; isPlaying = false; particles = []; if (!cleared && audioSource) audioSource.stop();
    ctx.fillStyle = cleared ? "rgba(0, 255, 255, 0.2)" : "rgba(255, 0, 0, 0.4)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    emojiGrid.innerHTML = ''; 
    let modeText = isPracticeMode ? 'PRACTICE MODE' : `Day ${dayIndex}`;
    let plainTextShare = `Neon Run - ${modeText}\n${cleared ? 'CLEARED' : 'FAILED'} | SCORE: ${score}\n\n`;
    let count = 0;

    beatmap.forEach(note => {
        if (note.hit || note.missed) {
            const grade = note.grade || '🟥'; plainTextShare += grade;
            const span = document.createElement('span');
            span.innerText = grade; span.title = emojiDescriptions[grade] || ''; 
            emojiGrid.appendChild(span);
            count++;
            if (count % 5 === 0) { emojiGrid.appendChild(document.createTextNode('\n')); plainTextShare += '\n'; }
        }
    });

    if (!isPracticeMode) {
        localStorage.setItem('neonRun_date', todayString); localStorage.setItem('neonRun_score', score);
        localStorage.setItem('neonRun_shareHTML', emojiGrid.innerHTML); localStorage.setItem('neonRun_plainShare', plainTextShare);
        localStorage.setItem('neonRun_cleared', cleared); startBtn.innerText = "ALREADY PLAYED"; startBtn.disabled = true;
    }

    const h2 = document.querySelector('#endScreen h2'); 
    h2.innerText = cleared ? "STAGE CLEARED" : "SYSTEM FAILURE"; h2.style.color = cleared ? "#39ff14" : "red"; h2.style.textShadow = cleared ? "0 0 10px rgba(57, 255, 20, 0.7)" : "0 0 10px red";
    
    if (isPracticeMode) { finalScoreText.innerText = `[PRACTICE] FINAL SCORE: ${score}`; shareBtn.style.display = 'none'; 
    } else { finalScoreText.innerText = `FINAL SCORE: ${score}`; shareBtn.style.display = 'inline-block'; }

    endScreen.style.display = 'block';

    shareBtn.onclick = () => {
        navigator.clipboard.writeText(plainTextShare).then(() => {
            shareBtn.innerText = "COPIED!"; shareBtn.style.background = "white";
            setTimeout(() => { shareBtn.innerText = "COPY TO CLIPBOARD"; shareBtn.style.background = "var(--neon-green)"; }, 2000);
        });
    };
}

function resetToMainMenu() {
    endScreen.style.display = 'none'; mainUI.style.display = 'flex'; ctx.clearRect(0, 0, canvas.width, canvas.height);
    score = 0; combo = 0; health = 100; feedbackText = ""; if (audioSource) audioSource.stop(); 
}

initGame();