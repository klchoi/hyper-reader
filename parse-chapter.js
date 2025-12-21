function parseArabicNumber(text) {
	const match = text.trim().match(/^\d+(\.\d+)?$/);
	return match ? Number.parseFloat(match[0]) : null;
}

function parseRomanNumber(text) {
	const roman = text.trim().toLowerCase();
	if (!/^[ivxlcdm]+$/.test(roman)) return null;

	const romanMap = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
	let sum = 0;

	for (let i = 0; i < roman.length; i++) {
		const cur = romanMap[roman[i]];
		const next = romanMap[roman[i + 1]] || 0;
		sum += cur < next ? -cur : cur;
	}

	return sum > 0 ? sum : null;
}


function parseNumber(text) {
	return (
		parseArabicNumber(text) ??
		parseRomanNumber(text) ??
		parseVietnameseNumber(text) ??
		null
	);
}

function cleanQuotes(text) {
	return text.replace(/[【】"“”《》#]/g, "").trim();
}

function parseChapter(input) {
	const result = {};
	const original = input;

	input = input.toLowerCase();

	// 1. Parse book title (in quotes or 【】 or 《》)
	const bookTitleMatch = original.match(/[【"《](.+?)[】"》]/);
	if (bookTitleMatch) {
		result.bookTitle = bookTitleMatch[1].trim();
	}

	// 2. Parse book volume (e.g., "bộ 2", "quyển thứ hai", "tập 6")
	const bookMatch = input.match(
		/\b(bộ|quyển|tập|cuốn)\s+(thứ\s+)?(\d+|[a-z]+)/,
	);
	if (bookMatch) {
		const value =
			Number.parseInt(bookMatch[3]) ||
			parseNumber(bookMatch[3]) ||
			null;
		if (value !== null) result.book = value;
	}

	// 3. Parse chapter number (Arabic or Vietnamese)
	const chapterMatch = input.match(
		/\bchương(?:\s+thứ)?\s*(\d+(?:\.\d+)?|[a-z\s]+)?/,
	);
	if (chapterMatch && chapterMatch[1]) {
		const chapter =
			Number.parseFloat(chapterMatch[1]) ||
			parseNumber(chapterMatch[1]);
		if (chapter) result.chapter = chapter;
	}

	// 4. Try short forms (e.g., “ch. 1”, “#3”, “(13)”, etc.)
	if (!result.chapter) {
		const shortForm = input.match(
			/(?:ch\.?|#|\(|[^a-z])\s*(\d{1,4}(?:\.\d+)?)(?=\D|$)/i,
		);
		if (shortForm) result.chapter = Number.parseFloat(shortForm[1]);
	}

	// 5. Parse chapter type (phiên ngoại, ngoại truyện, intro, ending)
	if (input.includes("phiên ngoại") || input.includes("(phiên ngoại)"))
		result.type = "phiên ngoại";
	if (input.includes("ngoại truyện")) result.type = "ngoại truyện";
	if (input.includes("lời dẫn")) result.type = "intro";
	if (input.includes("chương kết")) result.chapterType = "ending";

	// 6. Parse half titles (thượng, hạ, trung, nhất, nhị, tam, etc.)
	const halfMatch = input.match(
		/\((thượng|hạ|trung|nhất|nhị|tam|1|2|3|4|5|6|7|8|9|10|11|12)\)/,
	);
	if (halfMatch)
		result.half = isNaN(halfMatch[1])
			? halfMatch[1]
			: Number.parseInt(halfMatch[1]);

	// 7. Try extracting title from colon/parentheses
	const titleMatch = original.match(/[:：]\s*([^【(]+)/);
	if (titleMatch) result.title = cleanQuotes(titleMatch[1]);

	// 8. Or from end if inside parentheses
	if (!result.title) {
		const endTitleMatch = original.match(/\)\s*([^()【】]+)$/);
		if (endTitleMatch) result.title = cleanQuotes(endTitleMatch[1]);
	}

	// 9. Fallback: extract text after "chương [number]"
	if (!result.title && result.chapter) {
		const fallback = original.split(/chương\s+[^\s:]+[:：\-]*/i)[1];
		if (fallback) {
			const clean = fallback
				.trim()
				.replace(/[()]+$/, "")
				.trim();
			if (clean.length > 0) result.title = clean;
		}
	}

	return result;
}

export { parseChapter };
