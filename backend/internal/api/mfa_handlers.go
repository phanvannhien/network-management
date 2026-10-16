package api

import (
	"context"
	"errors"

	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/api/apigen"
	"github.com/phanvannhien/networkdiagramdrawer/backend/internal/auth"
)

const (
	msgNotSignedIn  = "Chưa đăng nhập"
	msgInvalidCode  = "Mã không đúng, đã hết hạn hoặc đã được dùng"
	msgMFAEnabled   = "MFA đã được bật"
	msgMFANotActive = "MFA chưa được bật"
)

// SetupMfa starts TOTP enrollment. Reachable by fully signed-in users and by users who must enroll.
func (s *Server) SetupMfa(ctx context.Context, _ apigen.SetupMfaRequestObject) (apigen.SetupMfaResponseObject, error) {
	sess, ok := sessionFrom(ctx)
	if !ok {
		return apigen.SetupMfa401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: msgNotSignedIn}}, nil
	}
	setup, err := s.auth.SetupTOTP(ctx, sess, infoFrom(ctx).meta)
	if errors.Is(err, auth.ErrMFAAlreadyEnabled) {
		return apigen.SetupMfa409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgMFAEnabled}}, nil
	}
	if err != nil {
		return nil, err
	}
	return apigen.SetupMfa200JSONResponse{Secret: setup.Secret, OtpauthUrl: setup.OtpauthURL, QrCode: setup.QRDataURL}, nil
}

// EnableMfa confirms enrollment and returns recovery codes (shown once).
func (s *Server) EnableMfa(ctx context.Context, req apigen.EnableMfaRequestObject) (apigen.EnableMfaResponseObject, error) {
	sess, ok := sessionFrom(ctx)
	if !ok {
		return apigen.EnableMfa401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: msgNotSignedIn}}, nil
	}
	code := ""
	if req.Body != nil {
		code = req.Body.Code
	}
	codes, err := s.auth.EnableTOTP(ctx, sess, code, infoFrom(ctx).meta)
	switch {
	case errors.Is(err, auth.ErrInvalidMFACode):
		return apigen.EnableMfa400JSONResponse{InvalidCodeJSONResponse: apigen.InvalidCodeJSONResponse{Message: msgInvalidCode}}, nil
	case errors.Is(err, auth.ErrMFAAlreadyEnabled):
		return apigen.EnableMfa409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgMFAEnabled}}, nil
	case errors.Is(err, auth.ErrMFANotPending):
		return apigen.EnableMfa409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: "Chưa bắt đầu thiết lập MFA"}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.EnableMfa200JSONResponse{RecoveryCodes: codes}, nil
}

// VerifyMfa completes sign-in with a TOTP or recovery code.
func (s *Server) VerifyMfa(ctx context.Context, req apigen.VerifyMfaRequestObject) (apigen.VerifyMfaResponseObject, error) {
	sess, ok := sessionFrom(ctx)
	if !ok {
		return apigen.VerifyMfa401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: msgNotSignedIn}}, nil
	}
	var code, recovery string
	if req.Body != nil {
		if req.Body.Code != nil {
			code = *req.Body.Code
		}
		if req.Body.RecoveryCode != nil {
			recovery = *req.Body.RecoveryCode
		}
	}
	err := s.auth.VerifyMFA(ctx, sess, code, recovery, infoFrom(ctx).meta)
	switch {
	case errors.Is(err, auth.ErrInvalidMFACode):
		return apigen.VerifyMfa401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: msgInvalidCode}}, nil
	case errors.Is(err, auth.ErrRateLimited):
		return apigen.VerifyMfa429JSONResponse{Message: "Nhập sai quá nhiều lần, vui lòng đợi một phút"}, nil
	case errors.Is(err, auth.ErrMFANotEnabled):
		return apigen.VerifyMfa409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgMFANotActive}}, nil
	case err != nil:
		return nil, err
	}
	sess.MFAVerified = true
	return apigen.VerifyMfa200JSONResponse(toAuthSession(sess)), nil
}

// DisableMfa removes MFA; the access gate only lets fully verified sessions reach this handler.
func (s *Server) DisableMfa(ctx context.Context, req apigen.DisableMfaRequestObject) (apigen.DisableMfaResponseObject, error) {
	sess, ok := sessionFrom(ctx)
	if !ok {
		return apigen.DisableMfa401JSONResponse{UnauthorizedJSONResponse: apigen.UnauthorizedJSONResponse{Message: msgNotSignedIn}}, nil
	}
	code := ""
	if req.Body != nil {
		code = req.Body.Code
	}
	err := s.auth.DisableTOTP(ctx, sess, code, infoFrom(ctx).meta)
	switch {
	case errors.Is(err, auth.ErrInvalidMFACode):
		return apigen.DisableMfa400JSONResponse{InvalidCodeJSONResponse: apigen.InvalidCodeJSONResponse{Message: msgInvalidCode}}, nil
	case errors.Is(err, auth.ErrMFARequired):
		return apigen.DisableMfa403JSONResponse{Message: "Tài khoản quản trị bắt buộc dùng MFA, không thể tắt"}, nil
	case errors.Is(err, auth.ErrMFANotEnabled):
		return apigen.DisableMfa409JSONResponse{ConflictJSONResponse: apigen.ConflictJSONResponse{Message: msgMFANotActive}}, nil
	case err != nil:
		return nil, err
	}
	return apigen.DisableMfa204Response{}, nil
}
