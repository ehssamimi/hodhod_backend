import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 254, unique: true })
  email!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'varchar', length: 16, default: 'student' })
  role!: 'student' | 'teacher' | 'admin';

  @Column({ name: 'display_name', type: 'varchar', length: 120, nullable: true })
  displayName!: string | null;

  @Column({ name: 'avatar_id', type: 'varchar', length: 128, nullable: true })
  avatarId!: string | null;

  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone!: string;

  @Column({ name: 'auth_version', type: 'integer', default: 0 })
  authVersion!: number;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false, insert: false, update: false })
  passwordHash!: string | null;
}
