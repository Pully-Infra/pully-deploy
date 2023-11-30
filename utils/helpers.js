const generateRandomWord = () => {
  const characters = "abcdefghijklmnopqrstuvwxyz";
  let result = "";

  for (let i = 0; i < 5; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return result;
};

module.exports = {
  randomWords: () => {
    const randomWord1 = generateRandomWord();
    const randomWord2 = generateRandomWord();
    return `${randomWord1}-${randomWord2}`;
  },
};
