import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentStore, type AgentRun } from './agentStore'

// The agent store's voice hooks (#35): listening status, the run source, and ask's result.

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => vi.useRealTimers())

describe('listening', () => {
  it('listen() shows listening; stopListening() settles back to idle', () => {
    const agent = createAgentStore(() => ({ text: 'ok' }))
    agent.listen()
    expect(agent.getState().status).toBe('listening')
    agent.stopListening()
    expect(agent.getState().status).toBe('idle')
  })

  it('stopListening() leaves other states alone (a reply already started)', () => {
    const agent = createAgentStore(() => ({ text: 'ok' }))
    agent.listen()
    agent.say('done.')
    agent.stopListening()
    expect(agent.getState().status).toBe('speaking')
  })
})

describe('ask', () => {
  it('passes the source to the run, defaulting to text', async () => {
    const run = vi.fn<AgentRun>(() => ({ text: 'ok' }))
    const agent = createAgentStore(run)
    await agent.ask('open notes')
    await agent.ask('open the browser', { source: 'voice' })
    expect(run.mock.calls[0][2]).toEqual({ source: 'text' })
    expect(run.mock.calls[1][2]).toEqual({ source: 'voice' })
  })

  it('resolves true for a reply, false when the run fails', async () => {
    const agent = createAgentStore((text) => (text === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve({ text: 'ok' })))
    const pending = agent.ask('hello', { source: 'voice' })
    expect(agent.getState().status).toBe('thinking')
    await expect(pending).resolves.toBe(true)
    expect(agent.getState().status).toBe('speaking')

    await expect(agent.ask('fail', { source: 'voice' })).resolves.toBe(false)
    expect(agent.getState()).toMatchObject({ status: 'error', replyError: true })
  })

  it('a run that throws synchronously is a failed run, not a crash', async () => {
    const agent = createAgentStore(() => {
      throw new Error('boom')
    })
    await expect(agent.ask('hi')).resolves.toBe(false)
    expect(agent.getState().replyError).toBe(true)
  })

  it('ignores blank requests', async () => {
    const run = vi.fn<AgentRun>(() => ({ text: 'ok' }))
    const agent = createAgentStore(run)
    await expect(agent.ask('   ')).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
