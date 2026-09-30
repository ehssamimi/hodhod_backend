import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { isNamedTimezone, ProfileSettingsDto } from './profile-settings.dto';

describe('Student settings validation', () => {
  it.each(['Asia/Tehran', 'Europe/Berlin', 'UTC', 'America/New_York'])('accepts %s', value => {
    expect(isNamedTimezone(value)).toBe(true);
  });
  it.each([null, '', '+03:30', 'Mars/Olympus', 123])('rejects invalid timezone %s', value => {
    expect(isNamedTimezone(value)).toBe(false);
    expect(validateSync(plainToInstance(ProfileSettingsDto, { timezone: value }))).not.toHaveLength(0);
  });
  it('trims display names and allows clearing optional selections', () => {
    const settings = plainToInstance(ProfileSettingsDto, { displayName: '  سارا  ', avatarId: null });
    expect(settings.displayName).toBe('سارا');
    expect(validateSync(settings)).toHaveLength(0);
  });
});
