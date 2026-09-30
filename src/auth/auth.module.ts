import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { OtpService } from './otp.service';
import { AccessGuard } from './access.guard';
import { ClassAccessService } from './class-access.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailService, OtpService, ClassAccessService, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: [ClassAccessService],
})
export class AuthModule {}
