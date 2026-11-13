import { expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, merge } from '../hooks/config'
import { SECTIONS, applyChoice, chosenIndex, detectedRows, fieldValue, initQuestions, parseInput } from '../hooks/configui'

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

test('init asks who delivers only when it proposed adapters, and picking wololo drops them without losing the question', async () => {
  const adapters = { plan: { steps: [{ cmd: 'make agent.plan ISSUE={issue} JSON=1' }] } }
  const proposed = { adapters, mirror: { list: 'make agent.status JSON=1', run: 'make agent.status RUN={run} JSON=1' } }
  expect(initQuestions(DEFAULT_CONFIG).map(q => q.id)).not.toContain('delivery')
  const [delivery] = initQuestions(DEFAULT_CONFIG, proposed)
  expect(delivery?.id).toBe('delivery')
  const runner = applyChoice(proposed, DEFAULT_CONFIG, delivery?.choices[0]?.set ?? {})
  expect(runner).toEqual(proposed)
  const wololo = applyChoice(proposed, DEFAULT_CONFIG, delivery?.choices[1]?.set ?? {})
  expect(wololo).toEqual({})
  expect(chosenIndex(delivery!, merge(DEFAULT_CONFIG, wololo))).toBe(1)
  expect(initQuestions(merge(DEFAULT_CONFIG, wololo), proposed)[0]?.id).toBe('delivery')
  expect(detectedRows(proposed, 'acme/shop', 'main', 'es')).toContainEqual(['Runner', 'plan'])
})
