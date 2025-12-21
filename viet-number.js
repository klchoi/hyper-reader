function parseVietnameseNumber(vietnameseNumber) {
	const input = vietnameseNumber.trim().toLowerCase();

	const basicNumbers = {
		không: 0,
		một: 1,
		hai: 2,
		ba: 3,
		bốn: 4,
		năm: 5,
		sáu: 6,
		bảy: 7,
		tám: 8,
		chín: 9,
	};

	const compositeNumbers = {
		mười: 10,
	};

	const units = {
		mươi: 10,
		trăm: 100,
		nghìn: 1000,
		ngàn: 1000,
	};

	const synonyms = {
		mốt: 1,
		tư: 4,
		lăm: 5,
	};

	const ignore = {
		linh: '',
		lẻ: '',
	};

	const types = {
		basic: {
			không: 0,
			một: 1,
			hai: 2,
			ba: 3,
			bốn: 4,
			năm: 5,
			sáu: 6,
			bảy: 7,
			tám: 8,
			chín: 9,
		},
		composite: {
			mười: 10,
		},
		units: {
			mươi: 10,
			trăm: 100,
			nghìn: 1000,
			ngàn: 1000,
		},
		synonyms: {
			mốt: 1,
			tư: 4,
			lăm: 5,
		},
		ignore: {
			linh: '',
			lẻ: '',
		},
	};

	const words = input.toLowerCase().split(/\s+/);


	let step = 'composite';
	let i = 0;
	let word;
	let value = 0;
	let total = 0;
	while ((word = words[i])) {
		switch (step) {
			case 'composite':
				value = 0;
				if (word in compositeNumbers) {
					value += compositeNumbers[word];
					i++;
				}
				step = 'basic';
				continue;
			case 'basic':
				if (word in basicNumbers) {
					value += basicNumbers[word];
					total += value;
					i++;
					step = 'unit';
					continue;
				}
				if ((word in synonyms) && (value > 0) && (i == words.length - 1)) {
					value += synonyms[word];
					total += value;
					i++;
					continue;
				}
			case 'unit':
				if (word in units) {
					value *= units[word];
					i++;
					step = 'basic';
					continue;
				}
		}
		return null;
	}
	return total;
}

export default parseVietnameseNumber;
