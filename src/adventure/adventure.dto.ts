import { ApiProperty } from '@nestjs/swagger';

export class AdventureStageDto {
  @ApiProperty({ format: 'uuid', description: 'Stable content ID of the stage' }) contentId!: string;
  @ApiProperty({ example: 1, description: 'Order on the map, ascending' }) position!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Stage that must be cleared first; null for an entry stage' }) prerequisiteContentId!: string | null;
  @ApiProperty({ example: 3, description: 'Best stars needed on the prerequisite to unlock this stage' }) unlockStars!: number;
  @ApiProperty({ example: 'ضرب اعداد دو رقمی' }) title!: string;
  @ApiProperty({ example: 'ضرب' }) subject!: string;
  @ApiProperty({ example: 'math3.multiply.two-digit' }) unityId!: string;
  @ApiProperty({ example: 1 }) version!: number;
  @ApiProperty({ enum: ['locked', 'unlocked'], description: 'Computed by the server for the authenticated student' }) status!: string;
  @ApiProperty({ example: 0 }) bestStars!: number;
  @ApiProperty({ example: 0 }) attemptCount!: number;
  @ApiProperty({ example: 5, description: 'Star ceiling of the applicable scoring rule (default 5)' }) maxStars!: number;
  @ApiProperty({ example: 3, description: 'Stars needed to pass this stage (default 3)' }) passStars!: number;
  @ApiProperty({ description: 'bestStars reached passStars' }) passed!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstPassedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastAttemptAt!: Date | null;
}

export class AdventureMapDto {
  @ApiProperty({ type: [AdventureStageDto], description: 'Published Adventure stages in order, including locked ones' })
  stages!: AdventureStageDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'First unlocked stage not yet passed; null when nothing is left to play' })
  nextContentId!: string | null;
}
