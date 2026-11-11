const whitespace = /[ \t\n]/;
const punctuation = /[!-/:-@[-\x60{-~]/;

function escaped(text, index) {
  return text[index] === '\\' && punctuation.test(text[index + 1] ?? '');
}

function skipWhitespace(text, index) {
  while (whitespace.test(text[index] ?? '')) index++;
  return index;
}

function readDelimited(text, start, delimiter, forbidden = '') {
  let value = '';
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (escaped(text, index)) value += text[++index];
    else if (character === delimiter) return { value, end: index + 1 };
    else if (forbidden.includes(character)) return undefined;
    else value += character;
  }
}

function readDestination(text, start) {
  if (text[start] === '<') return readDelimited(text, start + 1, '>', '<\n');
  let value = '';
  let depth = 0;
  let index = start;
  for (; index < text.length; index++) {
    const character = text[index];
    if (escaped(text, index)) {
      value += text[++index];
      continue;
    }
    if (whitespace.test(character) || (character === ')' && depth === 0)) break;
    if (character === '<' || character === '>') return undefined;
    if (character === '(') depth++;
    if (character === ')') depth--;
    value += character;
  }
  if (depth === 0) return { value, end: index };
}

function readLink(text, start) {
  const destination = readDestination(text, skipWhitespace(text, start));
  if (!destination) return undefined;
  let index = skipWhitespace(text, destination.end);
  const delimiter = text[index];
  if (index > destination.end && (delimiter === '"' || delimiter === "'")) {
    const title = readDelimited(text, index + 1, delimiter);
    if (!title) return undefined;
    index = skipWhitespace(text, title.end);
  }
  if (text[index] === ')') return { destination: destination.value, end: index + 1 };
}

function backtickRuns(text) {
  const runs = new Map();
  for (const match of text.matchAll(/`+/g)) {
    const width = match[0].length;
    if (!runs.has(width)) runs.set(width, []);
    runs.get(width).push(match.index);
  }
  return runs;
}

function firstRunAtOrAfter(positions = [], index) {
  let left = 0;
  let right = positions.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (positions[middle] < index) left = middle + 1;
    else right = middle;
  }
  return positions[left];
}

function* blockDestinations(text) {
  const backticks = backtickRuns(text);
  const openers = [];
  let linksFound = 0;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (escaped(text, index)) {
      index += 2;
      continue;
    }
    if (character === '`') {
      let end = index + 1;
      while (text[end] === '`') end++;
      const width = end - index;
      const closing = firstRunAtOrAfter(backticks.get(width), end);
      index = closing === undefined ? end : closing + width;
      continue;
    }
    if (character === '!' && text[index + 1] === '[') {
      openers.push({ image: true });
      index += 2;
      continue;
    }
    if (character === '[') openers.push({ image: false, linksFound });
    if (character === ']' && openers.length) {
      const opener = openers.pop();
      // A recognized link makes earlier link openers ineligible.
      if (text[index + 1] === '(' && (opener.image || opener.linksFound === linksFound)) {
        const link = readLink(text, index + 2);
        if (link) {
          if (!opener.image) linksFound++;
          yield link.destination;
          index = link.end;
          continue;
        }
      }
    }
    index++;
  }
}

function* inlineBlocks(markdown) {
  let fence;
  let paragraph = [];
  for (const line of markdown.split(/\r\n?|\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/s.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker && (marker[1][0] === '~' || !marker[2].includes('`'))) fence = marker[1];
    const atxHeading = /^ {0,3}#{1,6}(?:[ \t]|$)/.test(line);
    const setextUnderline = paragraph.length > 0 && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line);
    const thematicBreak = /^ {0,3}(?:\*(?:[ \t]*\*){2,}|-(?:[ \t]*-){2,}|_(?:[ \t]*_){2,})[ \t]*$/.test(line);
    if (fence || atxHeading || setextUnderline || thematicBreak || /^[ \t]*$/.test(line)) {
      if (paragraph.length) yield paragraph.join('\n');
      paragraph = [];
      if (atxHeading) yield line;
    } else {
      paragraph.push(line);
    }
  }
  if (paragraph.length) yield paragraph.join('\n');
}

export function* inlineLinkDestinations(markdown) {
  for (const block of inlineBlocks(markdown)) yield* blockDestinations(block);
}
