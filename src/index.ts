export type ParseItem<Result = unknown> =
  | string
  | RegExp
  | Iterable<ParseItem>
  | (() => Generator<ParseItem, Result, any>);
export type ParseYieldable<Result = unknown> = ParseItem<Result>;

export interface ParseError {
  iterationCount: number;
  yielded: ParseItem | Error;
  nested?: Array<ParseError>;
}

export type ParseResult<Result> =
  | {
      success: false;
      remaining: string;
      failedOn: ParseError;
    }
  | {
      success: true;
      remaining: string;
      result: Result;
    };

export type ParseYieldedValue<Input extends ParseItem> = Input extends RegExp
  ? RegExpMatchArray
  : string;

export type ParseGenerator<Result = unknown> =
  | Generator<ParseItem<any>, Result, string | RegExpMatchArray>
  | Generator<unknown, Result, undefined>
  | Iterable<ParseItem>;

export function parse<Result = void>(
  input: string,
  iterable: ParseGenerator<Result>
): ParseResult<Result> {
  let lastResult: ParseYieldedValue<ParseItem> | undefined;

  let iterationCount = -1;
  const iterator = iterable[Symbol.iterator]();

  main: while (true) {
    const nestedErrors: Array<ParseError> = [];

    iterationCount += 1;
    const next = iterator.next(lastResult as any);
    if (next.done) {
      if (next.value instanceof Error) {
        return {
          success: false,
          remaining: input,
          failedOn: {
            iterationCount,
            yielded: next.value,
          },
        };
      }

      return {
        success: true,
        remaining: input,
        result: next.value,
      };
    }

    const yielded = next.value as ParseItem;
    const choices =
      typeof yielded !== 'string' && (yielded as any)[Symbol.iterator]
        ? (yielded as Iterable<ParseItem>)
        : [yielded];

    for (const choice of choices) {
      if (typeof choice === 'string') {
        let found = false;
        const newInput = input.replace(choice, (_1, offset: number) => {
          found = offset === 0;
          return '';
        });
        if (found) {
          input = newInput;
          lastResult = choice;
          continue main;
        }
      } else if (choice instanceof RegExp) {
        if (['^', '$'].includes(choice.source[0]) === false) {
          throw new Error(`Regex must be from start: ${choice}`);
        }
        const match = input.match(choice);
        if (match) {
          lastResult = match;
          // input = input.replace(item, '');
          input = input.slice(match[0].length);
          continue main;
        }
      } else if (choice instanceof Function) {
        const choiceResult = parse(input, choice());
        if (choiceResult.success) {
          lastResult = choiceResult.result as any;
          input = choiceResult.remaining;
          continue main;
        } else if (choiceResult.failedOn) {
          nestedErrors.push(choiceResult.failedOn);
          // if (choiceResult.failedOn.iterationCount > 0) {
          //   return {
          //     success: false,
          //     remaining: input,
          //     failedOn: {
          //       iterationCount,
          //       yielded: choice,
          //       nested: nestedErrors.length === 0 ? undefined : nestedErrors,
          //     },
          //   };
          // }
        }
      }
    }

    return {
      success: false,
      remaining: input,
      failedOn: {
        iterationCount,
        yielded,
        nested: nestedErrors.length === 0 ? undefined : nestedErrors,
      },
    };
  }
}

export function* mustEnd() {
  yield /^$/;
}

export function* isEnd() {
  const { index }: { index: number } = yield /$/;
  return index === 0;
}

export function* hasMore() {
  const { index }: { index: number } = yield /$/;
  return index > 0;
  // return !(yield isEnd);
}

export function has(prefix: ParseYieldable): () => ParseGenerator<boolean> {
  return function* () {
    return (yield [prefix, '']) !== '';
  };
}

export function optional(...potentials: Array<ParseYieldable | any>): () => ParseGenerator<any> {
  return function* () {
    const result = yield [...potentials, ''];
    return result === '' ? undefined : result;
  };
}

export function lookAhead(regex: RegExp) {
  const lookAheadRegex = new RegExp(`^(?=${regex.source})`);
  return function* () {
    return yield lookAheadRegex;
  };
}
