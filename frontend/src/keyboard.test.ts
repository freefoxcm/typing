import { handGuideForCharacter } from './keyboard'

describe('hand guide mapping', () => {
  it('maps characters to the correct left and right hand fingers', () => {
    expect(handGuideForCharacter('f')).toMatchObject({ primary: ['l2'], modifier: [] })
    expect(handGuideForCharacter('j')).toMatchObject({ primary: ['r2'], modifier: [] })
    expect(handGuideForCharacter('3')).toMatchObject({ primary: ['l3'], modifier: [] })
    expect(handGuideForCharacter('9')).toMatchObject({ primary: ['r4'], modifier: [] })
  })

  it('adds the opposite pinky for shifted characters', () => {
    expect(handGuideForCharacter('A')).toMatchObject({ primary: ['l5'], modifier: ['r5'] })
    expect(handGuideForCharacter('?')).toMatchObject({ primary: ['r5'], modifier: ['l5'] })
  })

  it('allows either thumb for spaces', () => {
    expect(handGuideForCharacter(' ')).toEqual({
      primary: ['l1', 'r1'],
      modifier: [],
      label: '左手或右手拇指',
    })
  })

  it('returns no guide for unsupported characters', () => {
    expect(handGuideForCharacter('你')).toBeNull()
  })
})
