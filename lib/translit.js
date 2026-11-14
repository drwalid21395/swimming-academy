/* تحويل الأسماء والبيانات العربية إلى حروف لاتينية للبطاقات الإنجليزية (PDF)
   الهدف: بطاقة إنجليزية بالكامل بدون أي مربعات ناقصة في الخطوط */
const WORD_MAP = {
  /* أسماء أولاد */
  'احمد': 'Ahmed', 'محمد': 'Mohamed', 'محمود': 'Mahmoud', 'مصطفى': 'Mostafa', 'علي': 'Ali',
  'عمر': 'Omar', 'عمرو': 'Amr', 'خالد': 'Khaled', 'يوسف': 'Youssef', 'ابراهيم': 'Ibrahim',
  'حسن': 'Hassan', 'حسين': 'Hussein', 'عبدالله': 'Abdullah', 'عبدالرحمن': 'Abdelrahman',
  'عبدالرحيم': 'Abdelrahim', 'عبدالعزيز': 'Abdulaziz', 'عبدالظاهر': 'Abdelzaher',
  'عبدالفتاح': 'Abdelfattah', 'عبدالمنعم': 'Abdelmoneim', 'عبدالسلام': 'Abdelsalam',
  'مازن': 'Mazen', 'مالك': 'Malek', 'مروان': 'Marwan', 'مينا': 'Mina', 'بيتر': 'Peter',
  'جون': 'John', 'مارك': 'Mark', 'كريم': 'Karim', 'كمال': 'Kamal', 'كامل': 'Kamel',
  'سامي': 'Sami', 'سامح': 'Sameh', 'شريف': 'Sherif', 'طارق': 'Tarek', 'عادل': 'Adel',
  'عاطف': 'Atef', 'اشرف': 'Ashraf', 'ايمن': 'Ayman', 'ايهاب': 'Ehab', 'باسم': 'Bassem',
  'بلال': 'Bilal', 'تامر': 'Tamer', 'جمال': 'Gamal', 'حاتم': 'Hatem', 'حماده': 'Hamada',
  'رامي': 'Ramy', 'رضا': 'Reda', 'سعيد': 'Said', 'سليم': 'Selim', 'سمير': 'Samir',
  'سيد': 'Sayed', 'شادي': 'Shady', 'صابر': 'Saber', 'صلاح': 'Salah', 'عاصم': 'Asem',
  'عثمان': 'Osman', 'عصام': 'Essam', 'علاء': 'Alaa', 'فادي': 'Fadi', 'فتحي': 'Fathy',
  'فؤاد': 'Fouad', 'مجدي': 'Magdy', 'محسن': 'Mohsen', 'معاذ': 'Moaz', 'مكرم': 'Makram',
  'منصور': 'Mansour', 'مهدي': 'Mahdi', 'نادر': 'Nader', 'نبيل': 'Nabil', 'ناصر': 'Nasser',
  'نور': 'Nour', 'هادي': 'Hadi', 'هشام': 'Hesham', 'هيثم': 'Haitham', 'وائل': 'Wael',
  'وليد': 'Walid', 'ياسر': 'Yasser', 'ياسين': 'Yassin', 'يحيى': 'Yahya', 'زياد': 'Ziad',
  'سيف': 'Seif', 'ادهم': 'Adham', 'انس': 'Anas', 'ادم': 'Adam', 'الياس': 'Elias',
  'اكرم': 'Akram', 'امير': 'Amir', 'امين': 'Amin', 'اسلام': 'Islam', 'اسامه': 'Osama',
  'انور': 'Anwar', 'بشير': 'Bashir', 'حمدي': 'Hamdy', 'رشاد': 'Rashad', 'رفعت': 'Refaat',
  'رمضان': 'Ramadan', 'زكريا': 'Zakaria', 'سعد': 'Saad', 'سليمان': 'Soliman',
  'شعبان': 'Shaaban', 'صالح': 'Saleh', 'طه': 'Taha', 'عباس': 'Abbas', 'عز': 'Ezz',
  'عمار': 'Ammar', 'غانم': 'Ghanem', 'فريد': 'Farid', 'قاسم': 'Qasem', 'لؤي': 'Loay',
  'مؤمن': 'Momen', 'ماجد': 'Maged', 'مختار': 'Mokhtar', 'مرتضى': 'Murtada',
  'مسعود': 'Masoud', 'منير': 'Mounir', 'موسى': 'Mousa', 'ميشيل': 'Michael', 'ناجي': 'Naji',
  'نجيب': 'Naguib', 'هاني': 'Hany', 'هلال': 'Helal', 'عبد': 'Abd', 'مراد': 'Morad',
  'مروان': 'Marwan', 'ايمن': 'Ayman', 'شوقي': 'Shawky', 'صفوت': 'Safwat', 'لطفي': 'Lotfy',
  /* أسماء بنات */
  'مريم': 'Mariam', 'فاطمه': 'Fatma', 'عائشه': 'Aisha', 'خديجه': 'Khadija',
  'زينب': 'Zeinab', 'ساره': 'Sara', 'سلمى': 'Salma', 'هبه': 'Heba', 'دينا': 'Dina',
  'رنا': 'Rana', 'ريم': 'Reem', 'مي': 'Mai', 'منى': 'Mona', 'ناديه': 'Nadia',
  'نرمين': 'Nermin', 'هند': 'Hend', 'ياسمين': 'Yasmine', 'ايه': 'Aya', 'ايمان': 'Iman',
  'اميره': 'Amira', 'بسنت': 'Basant', 'جميله': 'Gamila', 'حبيبه': 'Habiba',
  'دعاء': 'Duaa', 'رحمه': 'Rahma', 'رقيه': 'Rogaya', 'سميه': 'Somaya', 'شروق': 'Shorouk',
  'صفاء': 'Safaa', 'عبير': 'Abeer', 'علياء': 'Alia', 'غاده': 'Ghada', 'فرح': 'Farah',
  'كارمن': 'Carmen', 'لبنى': 'Lobna', 'لمياء': 'Lamia', 'مروه': 'Marwa', 'منال': 'Manal',
  'نجلاء': 'Naglaa', 'نهى': 'Noha', 'هدى': 'Hoda', 'وفاء': 'Wafaa', 'ولاء': 'Walaa',
  'جنى': 'Jana', 'لينا': 'Lina', 'ملك': 'Malak', 'تالا': 'Tala', 'رهف': 'Rahaf',
  /* كلمات وبيانات */
  'اكاديميه': 'Academy', 'السباحه': 'Swimming', 'سباحه': 'Swimming', 'مجموعه': 'Group',
  'المجموعه': 'Group', 'الاول': 'First', 'الاولى': 'First', 'الثاني': 'Second',
  'الثانيه': 'Second', 'الثالث': 'Third', 'الثالثه': 'Third', 'الرابع': 'Fourth',
  'الرابعه': 'Fourth', 'الخامس': 'Fifth', 'الخامسه': 'Fifth', 'مدرب': 'Coach',
  'كابتن': 'Captain', 'برنامج': 'Program', 'تمهيدي': 'Preparatory', 'مبتدئ': 'Beginner',
  'متقدم': 'Advanced', 'ناشئ': 'Junior', 'فريق': 'Team', 'بطوله': 'Championship',
  'نادي': 'Club', 'مركز': 'Center', 'مدرسه': 'School', 'الدوليه': 'International',
  'الحديثه': 'Modern', 'النيل': 'Nile', 'مصر': 'Egypt', 'الجيزه': 'Giza',
  'القاهره': 'Cairo', 'الاسكندريه': 'Alexandria', 'الزمالك': 'Zamalek', 'الاهلي': 'Ahly',
  'نجوم': 'Stars', 'ابطال': 'Heroes', 'المستقبل': 'Future', 'الامل': 'Hope',
  'الطفوله': 'Childhood', 'الرياضه': 'Sports', 'تعليم': 'Learning', 'تدريب': 'Training',
  'صباحي': 'Morning', 'مسائي': 'Evening', 'صيف': 'Summer', 'شتاء': 'Winter',
  'لاعب': 'Player', 'لاعبه': 'Player', 'اختبار': 'Test', 'تجريبي': 'Trial',
  'حضور': 'Attendance', 'غياب': 'Absence', 'لاعبين': 'Players', 'سباح': 'Swimmer',
  'سباحه': 'Swimming', 'مبتدئين': 'Beginners', 'متقدمين': 'Advanced'
};

const PHRASE_MAP = [
  ['عبد الرحمن', 'Abdelrahman'],
  ['عبد الله', 'Abdullah'],
  ['عبد العزيز', 'Abdulaziz'],
  ['عبد الظاهر', 'Abdelzaher'],
  ['عبد الفتاح', 'Abdelfattah'],
  ['عبد المنعم', 'Abdelmoneim'],
  ['عبد السلام', 'Abdelsalam'],
  ['عبد الرحيم', 'Abdelrahim'],
  ['امير المؤمنين', 'Amir Almomineen']
];

const LETTER_MAP = {
  'ا': 'a', 'أ': 'a', 'إ': 'e', 'آ': 'a', 'ٱ': 'a', 'ى': 'a', 'ئ': 'e', 'ؤ': 'o', 'ء': '',
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh',
  'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z',
  'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'ة': 'a', 'و': 'o', 'ي': 'i', 'ﻻ': 'la'
};

/* إزالة التشكيل والتطويل وتوحيد الهمزات للمقارنة */
function normalizeArabic(text) {
  return String(text == null ? '' : text)
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

function fallbackWord(word) {
  let out = '';
  for (const ch of word) {
    out += Object.prototype.hasOwnProperty.call(LETTER_MAP, ch) ? LETTER_MAP[ch] : '';
  }
  /* إدخال حرف علة بسيط بين الحروف الساكنة لتسهيل القراءة */
  out = out.replace(/([bcdfghjklmnpqrstvwxyz])([bcdfghjklmnpqrstvwxyz])(?=[bcdfghjklmnpqrstvwxyz]|$)/gi, function (all, a, b) {
    return a + 'a' + b;
  });
  return capitalize(out.toLowerCase());
}

/* تحويل أي نص عربي إلى نص لاتيني آمن للطباعة */
function latinize(text) {
  let value = String(text == null ? '' : text);
  if (!/[\u0600-\u06FF]/.test(value)) return value;

  /* استبدال العبارات المركبة أولاً */
  PHRASE_MAP.forEach(function (pair) {
    const re = new RegExp(pair[0].replace(/\s+/g, '\\s+'), 'g');
    value = value.replace(re, pair[1]);
  });

  const words = normalizeArabic(value).split(' ').filter(Boolean);
  const out = words.map(function (raw) {
    const clean = raw.replace(/[^\u0600-\u06FFA-Za-z0-9]/g, '');
    if (!clean) return '';
    if (/^[A-Za-z0-9]+$/.test(clean)) return clean;
    if (WORD_MAP[clean]) return WORD_MAP[clean];
    if (WORD_MAP[clean.replace(/^ال/, '')]) return WORD_MAP[clean.replace(/^ال/, '')];
    return fallbackWord(clean);
  }).filter(Boolean);

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = { latinize, normalizeArabic };
