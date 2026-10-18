/**
 * What an animal adds to the actor contract (plan R3, §1.4): a name, an owning household or a herd home,
 * temperament and trained behaviours. No beliefs and no speech; memory is only familiarity and fear per actor,
 * which lives in the shared relation table.
 */
import type { ActorId } from './actors';
import { DerivedTable, f32, i32, u8 } from './table';

/** Trained behaviours, bit flags. */
export const TRAINED_LEASH = 1, TRAINED_RECALL = 2, TRAINED_GUARD = 4, TRAINED_RIDING = 8;

export const ANIMAL_COLUMNS = {
  actor: i32(-1),
  /** Owning household, -1 for wildlife. */
  household: i32(-1),
  /** The person who mostly looks after it (walks the dog, feeds the horse), -1 if none. */
  keeper: i32(-1),
  /** 0 calm .. 1 nervous/aggressive. Drives barking, biting, fleeing. */
  temperament: f32(1, 0.5),
  trained: u8(),
} as const;

export class AnimalTable extends DerivedTable<typeof ANIMAL_COLUMNS> {
  readonly name: string[] = [];

  constructor() { super(ANIMAL_COLUMNS, 64); }

  addAnimal(actor: ActorId, name: string): number {
    const r = this.t.add();
    this.t.cols.actor[r] = actor;
    this.name[r] = name;
    return r;
  }
}
