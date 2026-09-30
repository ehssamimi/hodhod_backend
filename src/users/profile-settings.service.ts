import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from './user.entity';
import { ProfileSettingsDto } from './profile-settings.dto';
import { profileOf } from './user.dto';

@Injectable()
export class ProfileSettingsService {
  constructor(private readonly source: DataSource) {}

  async update(actor: User, input: ProfileSettingsDto) {
    return this.source.transaction(async manager => {
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_write' } });
      if (!user || user.authVersion !== actor.authVersion) throw new UnauthorizedException('Session revoked');
      if (user.role !== 'student') throw new ForbiddenException('Student role required');
      if (input.displayName !== undefined) user.displayName = input.displayName;
      if (input.avatarId !== undefined) user.avatarId = input.avatarId;
      if (input.timezone !== undefined) {
        user.timezone = new Intl.DateTimeFormat('en', { timeZone: input.timezone }).resolvedOptions().timeZone;
      }
      await users.save(user);
      // Historical daily_activity timezone snapshots, attempts and scores are unchanged.
      return profileOf(user);
    });
  }
}
