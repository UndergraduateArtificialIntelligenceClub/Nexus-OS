// A safe code fixture. The viewer shows it as text, never executes it.

export interface Greeting {
  name: string
  punctuation?: string
}

export function greet({ name, punctuation = '!' }: Greeting): string {
  return `hello, ${name}${punctuation}`
}

export const MARK = '[<]'
