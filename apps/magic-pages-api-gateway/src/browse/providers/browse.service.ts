import { Injectable } from '@nestjs/common';
import { AgeGroupsService } from '../../age-groups/providers/age-groups.service';
import { CategoriesService } from '../../categories/providers/categories.service';

@Injectable()
export class BrowseService {
  constructor(
    private readonly ageGroupsService: AgeGroupsService,
    private readonly categoriesService: CategoriesService,
  ) { }

  async getMetadata() {
    const [ageGroups, categories] = await Promise.all([
      this.ageGroupsService.findAll(),
      this.categoriesService.findAll(),
    ]);

    // Hardcoded formats as per RFC
    const formats = [
      {
        id: "PDF",
        label: "PDF",
        description: "Instant digital downloads",
        benefit: "Read on any device",
        icon: "file-text"
      },
      {
        id: "PHYSICAL",
        label: "Physical",
        description: "Premium printed books",
        benefit: "Doorstep delivery",
        icon: "package"
      },
      {
        id: "WORKSHEETS",
        label: "Worksheets",
        description: "Practice & activities",
        benefit: "Print & practice",
        icon: "layers"
      }
    ];

    // Hardcoded collections as per RFC
    const collections = [
      {
        id: "bestsellers",
        title: "Bestsellers",
        description: "Most loved by families",
        link: "/search?filter=bestseller",
        icon: "trending-up",
        colorTheme: "text-primary"
      },
      {
        id: "new-releases",
        title: "New Releases",
        description: "Fresh magical stories",
        link: "/search?filter=new",
        icon: "sparkles",
        colorTheme: "text-accent-blue"
      },
      {
        id: "award-winners",
        title: "Award Winners",
        description: "Critically acclaimed books",
        link: "/search?filter=awards",
        icon: "award",
        colorTheme: "text-mint"
      },
      {
        id: "editors-picks",
        title: "Editor's Picks",
        description: "Handpicked favorites",
        link: "/search?filter=featured",
        icon: "heart",
        colorTheme: "text-warm-peach"
      }
    ];

    return {
      ageGroups,
      categories,
      formats,
      collections,
    };
  }
}
