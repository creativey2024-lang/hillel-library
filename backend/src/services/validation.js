const MAX_NOTE_LENGTH = 500;
const HEBREW_ONLY_REGEX = /^[א-ת]+$/;
const VALID_STATUSES = ['borrowed', 'returned', 'late'];

function validateNewRecord(data) {
  const errors = [];
  const studentName = String(data.studentName || '').trim();
  const studentClass = String(data.studentClass || '').trim();
  const bookName = String(data.bookName || '').trim();
  const borrowDate = String(data.borrowDate || '').trim();
  const returnDate = String(data.returnDate || '').trim();
  const note = typeof data.note === 'string' ? data.note.trim() : '';

  if (!studentName) errors.push('נא למלא את שם התלמיד/ה');
  if (!studentClass) errors.push('נא לבחור כיתה');
  if (!bookName) errors.push('נא למלא את שם הספר');
  if (!borrowDate) errors.push('נא למלא תאריך השאלה');
  if (!returnDate) errors.push('נא למלא תאריך החזרה מיועד');
  if (note.length > MAX_NOTE_LENGTH) errors.push(`ההערה ארוכה מדי (עד ${MAX_NOTE_LENGTH} תווים)`);

  return {
    valid: errors.length === 0,
    errors,
    data: { studentName, studentClass, bookName, borrowDate, returnDate, note },
  };
}

function validateNote(note) {
  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { valid: false, error: `ההערה ארוכה מדי (עד ${MAX_NOTE_LENGTH} תווים)` };
  }
  return { valid: true, note: trimmed };
}

function validateUsername(rawUsername) {
  const trimmed = String(rawUsername || '').trim();
  if (!trimmed) return { valid: false, error: 'נא להזין שם משתמש' };
  if (!HEBREW_ONLY_REGEX.test(trimmed)) {
    return { valid: false, error: 'יש להזין שם בעברית בלבד ללא רווחים ותווים מיוחדים' };
  }
  return { valid: true, username: trimmed };
}

function validateStatus(status) {
  return VALID_STATUSES.includes(status);
}

module.exports = {
  validateNewRecord,
  validateNote,
  validateUsername,
  validateStatus,
  MAX_NOTE_LENGTH,
  VALID_STATUSES,
};
