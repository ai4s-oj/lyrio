"""
POST http://162.105.151.213:2000/api/problem/getProblem

discussionCount: true
displayId: 1002
judgeInfo: true
judgeInfoToBePreprocessed: true
lastSubmissionAndLastAcceptedSubmission: true
localizedContentsOfLocale: "zh_CN"
permissionOfCurrentUser: true
samples: true
statistics: true
tagsOfLocale:  "zh_CN"
"""

import json
import requests

url = "http://162.105.151.213:2000/api/problem/getProblem"

headers = {
    "Content-Type": "application/json"
}

data = {
    "displayId": 1000,
    "discussionCount": True,
    "judgeInfo": True,
    "judgeInfoToBePreprocessed": True,
    "lastSubmissionAndLastAcceptedSubmission": True,
    "localizedContentsOfLocale": "zh_CN",
    "permissionOfCurrentUser": True,
    "samples": True,
    "statistics": True,
    "tagsOfLocale": "zh_CN"
}

try:
    response = requests.post(url, headers=headers, data=json.dumps(data), timeout=10)
    print(response.json())
except requests.exceptions.Timeout:
    print("请求超时")
except requests.exceptions.RequestException as e:
    print(f"请求错误: {e}")

# query: SELECT `ProblemEntity`.`id` AS `ProblemEntity_id`, `ProblemEntity`.`displayId` AS `ProblemEntity_displayId`, `ProblemEntity`.`type` AS `ProblemEntity_type`, `ProblemEntity`.`isPublic` AS `ProblemEntity_isPublic`, `ProblemEntity`.`publicTime` AS `ProblemEntity_publicTime`, `ProblemEntity`.`ownerId` AS `ProblemEntity_ownerId`, `ProblemEntity`.`locales` AS `ProblemEntity_locales`, `ProblemEntity`.`submissionCount` AS `ProblemEntity_submissionCount`, `ProblemEntity`.`acceptedSubmissionCount` AS `ProblemEntity_acceptedSubmissionCount` FROM `problem` `ProblemEntity` WHERE (`ProblemEntity`.`displayId` = ?) LIMIT 1 -- PARAMETERS: [1002]
# query: SELECT `ProblemTagMapEntity`.`id` AS `ProblemTagMapEntity_id`, `ProblemTagMapEntity`.`problemId` AS `ProblemTagMapEntity_problemId`, `ProblemTagMapEntity`.`problemTagId` AS `ProblemTagMapEntity_problemTagId` FROM `problem_tag_map` `ProblemTagMapEntity` WHERE (`ProblemTagMapEntity`.`problemId` = ?) -- PARAMETERS: [2]
# query: SELECT `ProblemSampleEntity`.`problemId` AS `ProblemSampleEntity_problemId`, `ProblemSampleEntity`.`data` AS `ProblemSampleEntity_data` FROM `problem_sample` `ProblemSampleEntity` WHERE (`ProblemSampleEntity`.`problemId` = ?) LIMIT 1 -- PARAMETERS: [2]
# query: SELECT COUNT(1) AS `cnt` FROM `discussion` `DiscussionEntity` WHERE (`DiscussionEntity`.`problemId` = ?) -- PARAMETERS: [2]
