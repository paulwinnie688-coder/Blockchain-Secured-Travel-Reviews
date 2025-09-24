import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV, bufferCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_LOCATION = 101;
const ERR_INVALID_REVIEW_TEXT = 102;
const ERR_INVALID_RATING = 103;
const ERR_INVALID_TIMESTAMP = 104;
const ERR_REVIEW_ALREADY_EXISTS = 105;
const ERR_USER_NOT_FOUND = 106;
const ERR_LOCATION_NOT_FOUND = 107;
const ERR_INVALID_HASH = 108;
const ERR_COOLDOWN_ACTIVE = 109;
const ERR_INVALID_REVIEW_ID = 110;

interface Review {
  userId: string;
  locationId: number;
  reviewText: string;
  rating: number;
  timestamp: number;
  reviewHash: Buffer;
  isActive: boolean;
}

interface UserReview {
  reviewId: number;
  lastSubmitted: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ReviewSubmissionMock {
  state: {
    reviewCounter: number;
    cooldownPeriod: number;
    authorityContract: string | null;
    reviews: Map<number, Review>;
    userReviews: Map<string, UserReview>;
    userRegistry: Map<string, boolean>;
    locationRegistry: Map<number, boolean>;
  } = {
    reviewCounter: 0,
    cooldownPeriod: 144,
    authorityContract: null,
    reviews: new Map(),
    userReviews: new Map(),
    userRegistry: new Map(),
    locationRegistry: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";

  reset() {
    this.state = {
      reviewCounter: 0,
      cooldownPeriod: 144,
      authorityContract: null,
      reviews: new Map(),
      userReviews: new Map(),
      userRegistry: new Map(),
      locationRegistry: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") return { ok: false, value: false };
    if (this.state.authorityContract !== null) return { ok: false, value: false };
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setCooldownPeriod(newPeriod: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newPeriod <= 0) return { ok: false, value: false };
    this.state.cooldownPeriod = newPeriod;
    return { ok: true, value: true };
  }

  submitReview(locationId: number, reviewText: string, rating: number): Result<number> {
    const userId = this.caller;
    const reviewHash = Buffer.from(reviewText);
    if (locationId <= 0) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!reviewText || reviewText.length > 500) return { ok: false, value: ERR_INVALID_REVIEW_TEXT };
    if (rating < 1 || rating > 5) return { ok: false, value: ERR_INVALID_RATING };
    if (this.blockHeight < 0) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    if (!this.state.userRegistry.has(userId)) return { ok: false, value: ERR_USER_NOT_FOUND };
    if (!this.state.locationRegistry.has(locationId)) return { ok: false, value: ERR_LOCATION_NOT_FOUND };
    const userReviewKey = `${userId}-${locationId}`;
    if (this.state.userReviews.has(userReviewKey)) return { ok: false, value: ERR_REVIEW_ALREADY_EXISTS };
    if (!this.state.authorityContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const reviewId = this.state.reviewCounter;
    this.state.reviews.set(reviewId, { userId, locationId, reviewText, rating, timestamp: this.blockHeight, reviewHash, isActive: true });
    this.state.userReviews.set(userReviewKey, { reviewId, lastSubmitted: this.blockHeight });
    this.state.reviewCounter++;
    return { ok: true, value: reviewId };
  }

  updateReview(reviewId: number, newText: string, newRating: number): Result<boolean> {
    const review = this.state.reviews.get(reviewId);
    if (!review) return { ok: false, value: false };
    if (review.userId !== this.caller) return { ok: false, value: false };
    if (!newText || newText.length > 500) return { ok: false, value: false };
    if (newRating < 1 || newRating > 5) return { ok: false, value: false };
    const newHash = Buffer.from(newText);
    this.state.reviews.set(reviewId, {
      userId: review.userId,
      locationId: review.locationId,
      reviewText: newText,
      rating: newRating,
      timestamp: this.blockHeight,
      reviewHash: newHash,
      isActive: true,
    });
    this.state.userReviews.set(`${review.userId}-${review.locationId}`, { reviewId, lastSubmitted: this.blockHeight });
    return { ok: true, value: true };
  }

  getReview(reviewId: number): Review | null {
    return this.state.reviews.get(reviewId) || null;
  }

  getUserReview(userId: string, locationId: number): UserReview | null {
    return this.state.userReviews.get(`${userId}-${locationId}`) || null;
  }

  getReviewCount(): Result<number> {
    return { ok: true, value: this.state.reviewCounter };
  }
}

describe("ReviewSubmission", () => {
  let contract: ReviewSubmissionMock;

  beforeEach(() => {
    contract = new ReviewSubmissionMock();
    contract.reset();
    contract.state.userRegistry.set("ST1TEST", true);
    contract.state.locationRegistry.set(1, true);
  });

  it("submits a review successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitReview(1, "Great place!", 4);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const review = contract.getReview(0);
    expect(review?.userId).toBe("ST1TEST");
    expect(review?.locationId).toBe(1);
    expect(review?.reviewText).toBe("Great place!");
    expect(review?.rating).toBe(4);
    expect(review?.timestamp).toBe(0);
    expect(review?.isActive).toBe(true);
  });

  it("rejects review with invalid location", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitReview(0, "Great place!", 4);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LOCATION);
  });

  it("rejects review with invalid text", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitReview(1, "", 4);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_REVIEW_TEXT);
  });

  it("rejects review with invalid rating", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.submitReview(1, "Great place!", 6);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RATING);
  });

  it("rejects review without user registration", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.userRegistry.clear();
    const result = contract.submitReview(1, "Great place!", 4);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_USER_NOT_FOUND);
  });

  it("rejects review without location registration", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.locationRegistry.clear();
    const result = contract.submitReview(1, "Great place!", 4);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_LOCATION_NOT_FOUND);
  });

  it("rejects duplicate review", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitReview(1, "Great place!", 4);
    const result = contract.submitReview(1, "Another review", 5);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_REVIEW_ALREADY_EXISTS);
  });

  it("updates a review successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitReview(1, "Great place!", 4);
    const result = contract.updateReview(0, "Updated review", 5);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const review = contract.getReview(0);
    expect(review?.reviewText).toBe("Updated review");
    expect(review?.rating).toBe(5);
    expect(review?.timestamp).toBe(0);
  });

  it("rejects update for non-existent review", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateReview(99, "Updated review", 5);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects update by non-owner", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitReview(1, "Great place!", 4);
    contract.caller = "ST2FAKE";
    const result = contract.updateReview(0, "Updated review", 5);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets cooldown period successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setCooldownPeriod(288);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.cooldownPeriod).toBe(288);
  });

  it("rejects cooldown period change without authority", () => {
    const result = contract.setCooldownPeriod(288);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct review count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.submitReview(1, "Great place!", 4);
    contract.state.locationRegistry.set(2, true);
    contract.submitReview(2, "Nice spot!", 3);
    const result = contract.getReviewCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("parses review parameters with Clarity types", () => {
    const text = stringUtf8CV("Great place!");
    const rating = uintCV(4);
    const locationId = uintCV(1);
    expect(text.value).toBe("Great place!");
    expect(rating.value).toEqual(BigInt(4));
    expect(locationId.value).toEqual(BigInt(1));
  });
});