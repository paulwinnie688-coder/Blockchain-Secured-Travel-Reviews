(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-LOCATION u101)
(define-constant ERR-INVALID-REVIEW-TEXT u102)
(define-constant ERR-INVALID-RATING u103)
(define-constant ERR-INVALID-TIMESTAMP u104)
(define-constant ERR-REVIEW-ALREADY-EXISTS u105)
(define-constant ERR-USER-NOT-FOUND u106)
(define-constant ERR-LOCATION-NOT-FOUND u107)
(define-constant ERR-INVALID-HASH u108)
(define-constant ERR-COOLDOWN-ACTIVE u109)
(define-constant ERR-INVALID-REVIEW-ID u110)

(define-data-var review-counter uint u0)
(define-data-var cooldown-period uint u144)
(define-data-var authority-contract (optional principal) none)

(define-map reviews
  { review-id: uint }
  {
    user-id: principal,
    location-id: uint,
    review-text: (string-utf8 500),
    rating: uint,
    timestamp: uint,
    review-hash: (buff 32),
    is-active: bool
  }
)

(define-map user-reviews
  { user-id: principal, location-id: uint }
  { review-id: uint, last-submitted: uint }
)

(define-read-only (get-review (review-id uint))
  (map-get? reviews { review-id: review-id })
)

(define-read-only (get-user-review (user-id principal) (location-id uint))
  (map-get? user-reviews { user-id: user-id, location-id: location-id })
)

(define-read-only (get-review-count)
  (ok (var-get review-counter))
)

(define-private (validate-location-id (location-id uint))
  (if (> location-id u0)
      (ok true)
      (err ERR-INVALID-LOCATION))
)

(define-private (validate-review-text (text (string-utf8 500)))
  (if (and (> (len text) u0) (<= (len text) u500))
      (ok true)
      (err ERR-INVALID-REVIEW-TEXT))
)

(define-private (validate-rating (rating uint))
  (if (and (>= rating u1) (<= rating u5))
      (ok true)
      (err ERR-INVALID-RATING))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-hash (hash (buff 32)) (text (string-utf8 500)))
  (if (is-eq hash (hash160 (to-buff text)))
      (ok true)
      (err ERR-INVALID-HASH))
)

(define-private (validate-cooldown (user-id principal) (location-id uint))
  (match (map-get? user-reviews { user-id: user-id, location-id: location-id })
    review
    (if (>= block-height (+ (get last-submitted review) (var-get cooldown-period)))
        (ok true)
        (err ERR-COOLDOWN-ACTIVE))
    (ok true))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-cooldown-period (new-period uint))
  (begin
    (asserts! (> new-period u0) (err ERR-INVALID-TIMESTAMP))
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set cooldown-period new-period)
    (ok true)
  )
)

(define-public (submit-review (location-id uint) (review-text (string-utf8 500)) (rating uint))
  (let
    (
      (review-id (var-get review-counter))
      (user-id tx-sender)
      (review-hash (hash160 (to-buff review-text)))
      (authority (var-get authority-contract))
    )
    (try! (validate-location-id location-id))
    (try! (validate-review-text review-text))
    (try! (validate-rating rating))
    (try! (validate-timestamp block-height))
    (try! (validate-hash review-hash review-text))
    (try! (validate-cooldown user-id location-id))
    (asserts! (is-some (map-get? user-registry { user-id: user-id })) (err ERR-USER-NOT-FOUND))
    (asserts! (is-some (map-get? location-registry { location-id: location-id })) (err ERR-LOCATION-NOT-FOUND))
    (asserts! (is-none (map-get? user-reviews { user-id: user-id, location-id: location-id })) (err ERR-REVIEW-ALREADY-EXISTS))
    (asserts! (is-some authority) (err ERR-NOT-AUTHORIZED))
    (map-set reviews { review-id: review-id }
      {
        user-id: user-id,
        location-id: location-id,
        review-text: review-text,
        rating: rating,
        timestamp: block-height,
        review-hash: review-hash,
        is-active: true
      }
    )
    (map-set user-reviews { user-id: user-id, location-id: location-id }
      { review-id: review-id, last-submitted: block-height }
    )
    (var-set review-counter (+ review-id u1))
    (print { event: "review-submitted", review-id: review-id, user-id: user-id, location-id: location-id })
    (ok review-id)
  )
)

(define-public (update-review (review-id uint) (new-text (string-utf8 500)) (new-rating uint))
  (let
    (
      (review (map-get? reviews { review-id: review-id }))
      (user-id tx-sender)
      (new-hash (hash160 (to-buff new-text)))
    )
    (match review
      r
      (begin
        (asserts! (is-eq (get user-id r) user-id) (err ERR-NOT-AUTHORIZED))
        (try! (validate-review-text new-text))
        (try! (validate-rating new-rating))
        (try! (validate-hash new-hash new-text))
        (map-set reviews { review-id: review-id }
          {
            user-id: user-id,
            location-id: (get location-id r),
            review-text: new-text,
            rating: new-rating,
            timestamp: block-height,
            review-hash: new-hash,
            is-active: true
          }
        )
        (map-set user-reviews { user-id: user-id, location-id: (get location-id r) }
          { review-id: review-id, last-submitted: block-height }
        )
        (print { event: "review-updated", review-id: review-id })
        (ok true)
      )
      (err ERR-INVALID-REVIEW-ID)
    )
  )
)