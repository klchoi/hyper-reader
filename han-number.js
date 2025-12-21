function parseHanNumber(text) {
  const digitMap = {
    'nhất': 1,
    'nhị': 2,
    'tam': 3,
    'tứ': 4,
    'ngũ': 5,
    'lục': 6,
    'thất': 7,
    'bát': 8,
    'cửu': 9
  };

  const unitMap = {
    'vạn': 10000,
    'thiên': 1000,
    'bách': 100,
    'thập': 10
  };

  const tokens = text.toLowerCase().split(/\s+/);
  let total = 0;
  let currentGroup = 0;
  let currentMultiplier = 0;

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];

    if (digitMap[word] !== undefined) {
      currentMultiplier = digitMap[word];
    } else if (unitMap[word] !== undefined) {
      const unitValue = unitMap[word];
      currentGroup += (currentMultiplier || 1) * unitValue;
      currentMultiplier = 0;
    } else {
      // skip or handle unrecognized tokens
    }
  }

  total = total + currentGroup + currentMultiplier;
  return total;
}

export default parseHanNumber;
