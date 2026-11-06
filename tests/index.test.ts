import { expect, test } from 'vitest'
import { analytics, vault } from '../src'

test('exports analytics and vault namespaces', () => {
  expect(analytics).toBeTruthy()
  expect(vault).toBeTruthy()
})