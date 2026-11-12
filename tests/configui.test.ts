import { expect, test } from 'claude-code/testing'

import { SECTIONS, fieldValue, parseInput } from '../hooks/configui'

const field = (path: string) => {
  const found = SECTIONS.flatMap(section => section.fields).find(item => item.path === path)
  if (!found) throw new Error(`no field ${path}`)
  return found
}

test('a list field shows one item per line and reads back what it showed', async () => {
  const risk = field('debate.risk_signals')
  const shown = fieldValue(risk, { debate: { risk_signals: ['migración', 'feature flag', 'external api'] } })
  expect(shown).toBe('migración\nfeature flag\nexternal api')
  expect(parseInput(risk, `${shown}\n  stock \n\n`).value).toEqual(['migración', 'feature flag', 'external api', 'stock'])
})

test('a command with a semicolon stays one command', async () => {
  expect(parseInput(field('tests.suite'), 'make a; make b\nmake c').value).toEqual(['make a; make b', 'make c'])
})
