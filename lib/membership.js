/** توليد رقم عضوية تالٍ بأمان:
   يعتمد على أعلى رقم رقمي فعلي بين كل اللاعبين (وليس آخر سطر بالترتيب)،
   فيتجنّب تصادم الأرقام مع صفوف قديمة أو محذوفة، ويدعم إعادة المحاولة عند المنافسة. */
const { db } = require('./db');

function digitCount(membershipNo) {
  const n = parseInt(String(membershipNo || '').replace(/\D/g, ''), 10) || 0;
  return n;
}

async function highestMembershipNumber() {
  let max = 0;
  const rows = await db.prepare('SELECT membership_no FROM swimmers').all();
  for (const r of rows) {
    const n = digitCount(r.membership_no);
    if (n > max) max = n;
  }
  return max;
}

async function nextMembership() {
  return 'SW-' + String((await highestMembershipNumber()) + 1).padStart(4, '0');
}

function isUniqueViolation(e) {
  const msg = String((e && e.message) || (e && e.cause && e.cause.message) || '').toLowerCase();
  return msg.includes('unique');
}

module.exports = { nextMembership, highestMembershipNumber, isUniqueViolation };