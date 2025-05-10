const admin = require('firebase-admin');
const axios = require('axios');
const { format } = require('date-fns');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_DAILY_VIDEOS = 40;
const TARGET_HOUR = 23;
const REQUEST_DELAY = 1500;

const CHANNELS = [
'UCcQ18ScARDXR0hf-OMQofsw', // ox_zung 
'UCSYuOoOUKFA3eZ0L8sRXSTQ', //wish SA 
'UCJadYQZAbzhNweKK621hVQg', // Sósia do Vini Jr
'UCYXrKtLb_uC8vlvalVgef3Q', // Shon Edit
'UCgDBOyrroHE07kPmeA-Ukyw', // Anne P
'UCSn-PqF7wU5gXJRpck4ZQIA', // Peter Nguyen
'UCiLjzcRKUqk0IMxhzyyYFyQ', // Wars JR
'UCpCLsVt-9LhvDKvEzE7Kw7A', // Bridon Production LLC Seany Tv
'UCtH7B4OprU9bUYA0xknelng', // LiveRankings
'UCCfKlFlKYBxZ-UU2dWc17IQ', // boxtoxtv
'UCuj-Tt5acrmGbujvRxVv9Fg', // DOVE CLUBB
'UC77xNOzWNYsS8dP2HSkjEEw', //FARUKKHANCR7
'UCQR0MYr5hvRlWIkrRNZ_mLg', // Laugh Hub
'UCYwi1YamkmM9zsm_k27iC_Q', // Tokyo_boy 
'UCtjYtFpwvLoy9gt1GDK2klg', // Kristen Hanby
'UCEr55381WIqO1w_IzgcI5DQ', // Anwar Jibawi
'UCV4uuw1QDPhoiyweotfA5rw', // AdamW
'UC82rNcKjcMnllk_P2cxheJw', // Bebahan
'UCb9A6uotqUiuVCvVp4GMqOg', // Justin Flom
'UCwmGHKwW6AE_NBQ3CNcO9-A', // Oscar's Funny World
'UCD5Bq1i3pZPKIw4bJ856yZg', // Alex & Annet
'UC24QmKMD73AwOYyCciq3pjA', // Respect
'UCdgHLEnxO50MI4yB6MYSlbQ', // Shock Cat Reaction
'UCfsmz7-5_Gw2UlPmCn1LMjQ', // Enjoy Wrestling 
'UCgrdZm9Nx3rCj8WenIoSIqw', // Nicocapone
'UCW33L17SyCw3-W4uFBLMjgQ', // Mahdi Fun
'UCq5hJ7CjhJLRWlcykcZqq1A', // benbu
'UCBGbTTcgn8AVEsEWdT3tI3Q', // IGP
'UCQBzn-XGeA4sq9kB8Gl8iHg', // Victoria Pfeifer
'UCBdDCfMX_NaRYLejRJHZZ1A', // LewisBlogsGaming
'UCFrpmAojFL9HlgBPU5p6Nog', // ItzSurajBro
'UCMh3v4KOrtoDKziO9d2qAHg', // Agirlandadoodle 
'UCdX5KXiCTPYWYZscfphgQ4g', // BeatboxJCOP 
'UCc0ulU8V23Fp-s9MGdo4pfg', // Mega Foodie
'UC4sQeLmtseXrdWUNI8LHINg', // ossol
'UC_apha4piyJCHSuYZbSi8uA', // Joga Bonito BR
'UCH8x9zAJbpfipmHosNuwu_A', // Endless Love 
'UCUvYDuZ2dwhYib7k7WneIRA', // Aexon1
'UC2HJGHpNnoWvLBey9xNrEPg', // Andrew wave 
'UCRS2sBiQZjLO6NJaYwHKeYg' // Fuzzie queen beatzz
];

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});
const db = admin.firestore();

const channelCache = new Map();

async function fetchVideos() {
    try {
        if (!isRightTime()) {
            console.log('⏳ Not the scheduled time (6 PM Morocco)');
            return;
        }

        if (await isDailyLimitReached()) {
            console.log(`🎯 Daily limit reached (${MAX_DAILY_VIDEOS} videos)`);
            return;
        }

        const videos = await fetchAllVideos();
        
        if (videos.length > 0) {
            await saveVideos(videos);
            console.log(
                `✅ Added ${videos.length} videos\n` +
                `📊 Quota used: ${calculateQuota(videos.length)} units\n` +
                `⏰ ${format(new Date(), 'yyyy-MM-dd HH:mm')}`
            );
        } else {
            console.log('⚠️ No new videos found today');
        }

        await logExecution(videos.length);

    } catch (error) {
        console.error('❌ Main error:', error);
        await logError(error);
        process.exit(0);
    }
}

function isRightTime() {
    const now = new Date();
    const moroccoTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Casablanca' }));
    return moroccoTime.getHours() === TARGET_HOUR;
}

async function isDailyLimitReached() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const snapshot = await db.collection('videos')
        .where('timestamp', '>=', todayStart)
        .count()
        .get();

    return snapshot.data().count >= MAX_DAILY_VIDEOS;
}

async function fetchAllVideos() {
    const videos = [];
    
    for (const channelId of CHANNELS) {
        try {
            await delay(REQUEST_DELAY);
            const video = await fetchChannelVideo(channelId);
            if (video) videos.push(video);
        } catch (error) {
            console.error(`❌ ${channelId}:`, error.message);
        }
    }
    
    return videos;
}

async function fetchChannelVideo(channelId) {
    const videoId = await getLatestVideoId(channelId);
    if (!videoId) return null;

    if (await isVideoExists(videoId)) {
        console.log(`⏭️ Skipping existing video: ${videoId}`);
        return null;
    }

    return await getVideoDetails(videoId);
}

async function getLatestVideoId(channelId) {
    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}` +
        `&channelId=${channelId}&part=snippet&order=date` +
        `&maxResults=1&type=video&videoDuration=short` +
        `&fields=items(id(videoId),snippet(title))`
    );

    return response.data.items[0]?.id.videoId;
}

async function isVideoExists(videoId) {
    const doc = await db.collection('videos').doc(videoId).get();
    return doc.exists;
}

async function getVideoDetails(videoId) {
    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?key=${YOUTUBE_API_KEY}` +
        `&id=${videoId}&part=snippet,contentDetails,statistics` +
        `&fields=items(snippet(title,description,thumbnails/high,channelId),contentDetails/duration,statistics)`
    );

    const item = response.data.items[0];
    if (!item) return null;

    const duration = parseDuration(item.contentDetails.duration);
    if (duration > 180) return null;

    const channelInfo = await getChannelInfo(item.snippet.channelId);
    
    return {
        videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.high.url,
        duration: item.contentDetails.duration,
        durationSeconds: duration,
        creatorUsername: channelInfo.title,
        creatorAvatar: channelInfo.avatar,
        isVerified: channelInfo.isVerified,
        likes: parseInt(item.statistics?.likeCount || 0),
        comments: parseInt(item.statistics?.commentCount || 0),
        isAI: true,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
}

async function getChannelInfo(channelId) {
    if (channelCache.has(channelId)) {
        return channelCache.get(channelId);
    }

    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/channels?key=${YOUTUBE_API_KEY}` +
        `&id=${channelId}&part=snippet,status` +
        `&fields=items(snippet(title,thumbnails/high/url),status)`
    );

    const data = response.data.items[0];
    const result = {
        title: data.snippet.title,
        avatar: data.snippet.thumbnails.high.url,
        isVerified: data.status?.longUploadsStatus === "eligible"
    };

    channelCache.set(channelId, result);
    return result;
}

async function saveVideos(videos) {
    const batch = db.batch();
    
    videos.forEach(video => {
        const ref = db.collection('videos').doc(video.videoId);
        batch.set(ref, video);
    });
    
    await batch.commit();
}

async function logExecution(count) {
    await db.collection('logs').add({
        date: admin.firestore.FieldValue.serverTimestamp(),
        videoCount: count,
        quotaUsed: calculateQuota(count)
    });
}

async function logError(error) {
    await db.collection('errors').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        message: error.message,
        stack: error.stack
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDuration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    return (parseInt(match?.[1] || 0) * 3600) +
          (parseInt(match?.[2] || 0) * 60) +
          (parseInt(match?.[3] || 0));
}

function calculateQuota(videoCount) {
    return videoCount * 102;
}

fetchVideos();
