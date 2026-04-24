import { apiService } from "@/lumilake/services/api";
import { UserProfileInfo } from "@/lumilake/types/userprofile";

export class UserProfileService {
  static async getMe(): Promise<UserProfileInfo> {
    return apiService.get<UserProfileInfo>("/principals/me");
  }
}