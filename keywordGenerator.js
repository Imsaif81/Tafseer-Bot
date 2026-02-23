const { normalizeText } = require("./utils");

const TOPIC_ORDER = [
  "sleep",
  "morning",
  "evening",
  "travel",
  "anxiety",
  "protection",
  "forgiveness",
  "health",
  "money_rizq",
  "exam",
  "sadness",
  "anger",
  "fear"
];

const TOPIC_BUNDLES = {
  sleep: {
    triggers: ["sleep", "sleeping", "bed", "night", "before sleeping", "wake up", "wakeup"],
    en: ["sleep dua", "before sleep", "night supplication"],
    ur: ["سونے کی دعا", "نیند کی دعا"],
    roman: ["sone ki dua", "neend ki dua"],
    ar: ["دعاء النوم", "أذكار النوم"],
    tags: ["sleep", "night"]
  },
  morning: {
    triggers: ["morning", "sunrise", "fajr", "day begins"],
    en: ["morning dua", "morning adhkar"],
    ur: ["صبح کی دعا", "صبح کے اذکار"],
    roman: ["subah ki dua", "subah azkar"],
    ar: ["أذكار الصباح", "دعاء الصباح"],
    tags: ["morning", "adhkar"]
  },
  evening: {
    triggers: ["evening", "nightfall", "maghrib", "sunset"],
    en: ["evening dua", "evening adhkar"],
    ur: ["شام کی دعا", "شام کے اذکار"],
    roman: ["shaam ki dua", "shaam azkar"],
    ar: ["أذكار المساء", "دعاء المساء"],
    tags: ["evening", "adhkar"]
  },
  travel: {
    triggers: ["travel", "journey", "vehicle", "ride", "safar", "riding"],
    en: ["travel dua", "journey dua", "safar dua"],
    ur: ["سفر کی دعا"],
    roman: ["safar ki dua", "travel dua"],
    ar: ["دعاء السفر"],
    tags: ["travel", "journey"]
  },
  anxiety: {
    triggers: ["anxiety", "distress", "worry", "depressed", "stress", "grief"],
    en: ["dua for anxiety", "dua for stress"],
    ur: ["پریشانی کی دعا", "غم کی دعا"],
    roman: ["pareshani ki dua", "gham ki dua"],
    ar: ["دعاء الهم", "دعاء الكرب"],
    tags: ["anxiety", "stress"]
  },
  protection: {
    triggers: ["protection", "evil eye", "safe", "security", "danger", "harm"],
    en: ["protection dua", "safety dua"],
    ur: ["حفاظت کی دعا"],
    roman: ["hifazat ki dua"],
    ar: ["دعاء الحفظ", "دعاء الوقاية"],
    tags: ["protection", "safety"]
  },
  forgiveness: {
    triggers: ["forgive", "forgiveness", "repent", "repentance", "istighfar", "sin"],
    en: ["dua for forgiveness", "istighfar dua"],
    ur: ["استغفار", "معافی کی دعا"],
    roman: ["astaghfar", "maafi ki dua"],
    ar: ["دعاء الاستغفار", "التوبة"],
    tags: ["forgiveness", "tawbah"]
  },
  health: {
    triggers: ["health", "sick", "illness", "disease", "healing", "cure"],
    en: ["dua for health", "healing dua", "shifa dua"],
    ur: ["شفا کی دعا", "صحت کی دعا"],
    roman: ["shifa ki dua", "sehat ki dua"],
    ar: ["دعاء الشفاء", "الصحة"],
    tags: ["health", "healing"]
  },
  money_rizq: {
    triggers: ["rizq", "money", "wealth", "provision", "income", "job", "debt", "financial"],
    en: ["rizq dua", "dua for wealth", "dua for job"],
    ur: ["رزق کی دعا", "مال کی دعا"],
    roman: ["rizq ki dua", "rozi ki dua"],
    ar: ["دعاء الرزق"],
    tags: ["rizq", "provision"]
  },
  exam: {
    triggers: ["exam", "study", "knowledge", "test", "school", "university"],
    en: ["dua for exam", "dua for study", "dua for knowledge"],
    ur: ["امتحان کی دعا", "پڑھائی کی دعا"],
    roman: ["imtihan ki dua", "parhai ki dua"],
    ar: ["دعاء الامتحان", "دعاء طلب العلم"],
    tags: ["exam", "study"]
  },
  sadness: {
    triggers: ["sad", "sadness", "sorrow", "grief", "heartbroken"],
    en: ["dua for sadness", "dua for grief"],
    ur: ["اداسی کی دعا", "غم کی دعا"],
    roman: ["udasi ki dua", "gham ki dua"],
    ar: ["دعاء الحزن"],
    tags: ["sadness", "grief"]
  },
  anger: {
    triggers: ["anger", "angry", "rage", "temper"],
    en: ["dua for anger", "control anger dua"],
    ur: ["غصہ کم کرنے کی دعا"],
    roman: ["ghussa control dua"],
    ar: ["دعاء الغضب"],
    tags: ["anger", "patience"]
  },
  fear: {
    triggers: ["fear", "afraid", "scared", "fright", "panic"],
    en: ["dua for fear", "dua for protection from fear"],
    ur: ["خوف کی دعا"],
    roman: ["khauf ki dua"],
    ar: ["دعاء الخوف"],
    tags: ["fear", "courage"]
  }
};

const CATEGORY_TO_TOPIC = {
  morning: "morning",
  evening: "evening",
  sleep: "sleep",
  travel: "travel"
};

function toCsv(values) {
  return [...new Set(values.filter(Boolean))].join(", ");
}

function addBundleToSets(bundle, sets) {
  for (const value of bundle.en) sets.en.add(value);
  for (const value of bundle.ur) sets.ur.add(value);
  for (const value of bundle.roman) sets.roman.add(value);
  for (const value of bundle.ar) sets.ar.add(value);
  for (const value of bundle.tags) sets.tags.add(value);
}

function inferCategory(chapterTitleEn = "") {
  const title = normalizeText(chapterTitleEn);

  if (title.includes("morning")) return "Morning";
  if (title.includes("evening")) return "Evening";
  if (title.includes("sleep") || title.includes("wake up")) return "Sleep";
  if (title.includes("travel") || title.includes("journey") || title.includes("riding")) return "Travel";
  if (title.includes("forgiveness") || title.includes("repent")) return "Forgiveness";
  if (title.includes("protection") || title.includes("safety")) return "Protection";
  if (title.includes("sick") || title.includes("illness") || title.includes("healing")) return "Health";
  return "General";
}

function detectTopics({ chapterTitleEn = "", category = "", englishText = "" }) {
  const haystack = normalizeText(`${chapterTitleEn} ${category} ${englishText}`);
  const topics = new Set();

  for (const topic of TOPIC_ORDER) {
    const bundle = TOPIC_BUNDLES[topic];
    if (bundle.triggers.some((trigger) => haystack.includes(normalizeText(trigger)))) {
      topics.add(topic);
    }
  }

  const categoryTopic = CATEGORY_TO_TOPIC[normalizeText(category)];
  if (categoryTopic) {
    topics.add(categoryTopic);
  }

  return topics;
}

function generateKeywordBundle({ chapterTitleEn = "", category = "General", englishText = "", arabicText = "" }) {
  const topics = detectTopics({ chapterTitleEn, category, englishText });

  const sets = {
    en: new Set(),
    ur: new Set(),
    roman: new Set(),
    ar: new Set(),
    tags: new Set()
  };

  for (const topic of TOPIC_ORDER) {
    if (!topics.has(topic)) {
      continue;
    }
    addBundleToSets(TOPIC_BUNDLES[topic], sets);
  }

  sets.en.add(`${category} dua`);
  sets.tags.add(normalizeText(category) || "general");

  const keywords_en = toCsv([...sets.en]);
  const keywords_ur = toCsv([...sets.ur]);
  const keywords_roman = toCsv([...sets.roman]);
  const keywords_ar = toCsv([...sets.ar]);
  const tags = toCsv([...sets.tags]);

  const search_blob = normalizeText(
    [
      chapterTitleEn,
      category,
      englishText,
      arabicText,
      keywords_en,
      keywords_ur,
      keywords_roman,
      keywords_ar,
      tags
    ].join(" ")
  );

  return {
    keywords_en,
    keywords_ur,
    keywords_roman,
    keywords_ar,
    tags,
    search_blob
  };
}

module.exports = {
  inferCategory,
  generateKeywordBundle
};
