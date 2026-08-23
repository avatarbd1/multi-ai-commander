import type { ReviewReport, TaskContract } from '../commander/types.js';

export function validateReviewCoverage(task: TaskContract, review: ReviewReport): string[] {
  const errors: string[] = [];
  const reviewed = new Set(review.requirements.map((item) => item.criterionId));
  for (const criterion of task.acceptanceCriteria) {
    if (!reviewed.has(criterion.id)) errors.push(`missing review for criterion ${criterion.id}`);
  }
  return errors;
}
